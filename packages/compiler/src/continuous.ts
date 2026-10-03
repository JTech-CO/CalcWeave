import { CONTINUOUS_BOUNDARY_TYPES, CONTINUOUS_STATE_TYPES, MODEL_LIMITS, ModelError, normalizeSolverSettings, type CalcModel, type ExpressionNode, type IRNode, type SignalDescriptor } from '../../model/src';
import { getBlockDefinition, getDirectFeedthroughPorts, isDirectFeedthrough } from '../../block-library/src';
import { M9_BLOCK_IDS } from '../../block-library/src/m9';
import { M11_BLOCK_DEFINITIONS } from '../../block-library/src/m11';
import { EXPANDED_TIME_SOURCE_IDS } from '../../block-library/src/time-sources';
import { m8HasUnregisteredJump, m8JumpControlPorts } from './m8';

const continuousSources: ReadonlySet<string> = new Set(['source.step', 'source.ramp', 'source.sine-wave', 'source.repeating-sequence', 'source.clock', ...EXPANDED_TIME_SOURCE_IDS]);
const sampled: ReadonlySet<string> = new Set(['source.random', 'source.digital-clock', 'source.pulse', 'logic.edge-detect', 'time.rate-transition', 'time.zero-order-hold', 'fixed.state-space', ...M9_BLOCK_IDS, ...M11_BLOCK_DEFINITIONS.filter(definition => definition.state !== 'none' || definition.sampleTime === 'fixed-tick' || ['route.data-store-read', 'route.data-store-write', 'state.reader', 'state.writer', 'state.parameter-writer'].includes(definition.id)).map(definition => definition.id)]);
const boundary = new Set(['time.zero-order-hold', 'time.first-order-hold']);
const fail = (node: IRNode, code: string, message: string, portId?: string): never => { throw new ModelError([{ code, nodeId: node.id, message, ...(portId ? { portId } : {}) }]); };

export function initialContinuousDescriptor(node: IRNode): SignalDescriptor | undefined {
  if (!CONTINUOUS_STATE_TYPES.includes(node.blockType) && !CONTINUOUS_BOUNDARY_TYPES.includes(node.blockType)) return undefined;
  return { valueType: node.blockType === 'logic.hit-crossing' ? 'boolean' : 'float64', shape: [], unit: '1' };
}

export function validateContinuousParameters(node: IRNode, model: CalcModel): void {
  if (model.execution.mode !== 'continuous') return;
  const p = node.parameters;
  const invalid = (message: string): never => fail(node, 'INVALID_PARAMETERS', message);
  const vector = (key: string, min: number, max: number): number[] => {
    const value = p[key];
    if (!Array.isArray(value) || value.length < min || value.length > max || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) invalid(`${key}는 ${min}~${max}개 원소의 유한한 숫자 vector여야 합니다.`);
    return value as number[];
  };
  const proper = (numerator: number[], denominator: number[]): void => {
    if (denominator[0] === 0 || numerator.length > denominator.length) invalid('분모 첫 계수는 0이 아니고 분자 차수는 분모 차수 이하여야 합니다.');
    if ([...numerator, ...denominator].some((item) => !Number.isFinite(item / denominator[0]!))) invalid('첫 분모 계수로 정규화한 전달 함수 계수는 유한해야 합니다.');
    const n = denominator.length - 1;
    if (vector('initial', 0, 16).length !== n) invalid(`전달 함수의 초기 상태 길이는 분모 차수 ${n}이어야 합니다.`);
    const direct = numerator.length === denominator.length ? numerator[0]! / denominator[0]! : 0;
    const padded = Array.from({ length: denominator.length - numerator.length }, () => 0).concat(numerator);
    for (let i = 1; i <= n; i++) if (!Number.isFinite(padded[i]! / denominator[0]! - direct * denominator[i]! / denominator[0]!)) invalid('정규형 전달 함수의 출력 계수가 유한하지 않습니다.');
  };
  const polynomial = (roots: number[]): number[] => {
    let coefficients = [1];
    for (const root of roots) {
      const next = Array.from({ length: coefficients.length + 1 }, () => 0);
      coefficients.forEach((coefficient, index) => { next[index] += coefficient; next[index + 1] -= root * coefficient; });
      if (next.some((coefficient) => !Number.isFinite(coefficient))) invalid('영점·극점의 다항식 계수가 유한하지 않습니다.');
      coefficients = next;
    }
    return coefficients;
  };
  switch (node.blockType) {
    case 'continuous.state-space': {
      const initial = vector('initial', 1, 16); const b = vector('B', 1, 16); const c = vector('C', 1, 16);
      const a = p.A; const n = initial.length;
      if (!Array.isArray(a) || a.length !== n || a.some((row) => !Array.isArray(row) || row.length !== n || row.some((item) => typeof item !== 'number' || !Number.isFinite(item))) || b.length !== n || c.length !== n) invalid('상태 공간은 A N×N, B/C/initial 길이 N인 scalar SISO 모델이어야 합니다. N은 1~16입니다.');
      break;
    }
    case 'continuous.transfer-function': proper(vector('numerator', 1, 17), vector('denominator', 1, 17)); break;
    case 'continuous.zero-pole': {
      const zeros = vector('zeros', 0, 16); const poles = vector('poles', 0, 16);
      if (zeros.length > poles.length) invalid('영점 개수는 극점 개수 이하여야 합니다.');
      const numerator = polynomial(zeros).map((coefficient) => coefficient * (p.gain as number));
      if (numerator.some((coefficient) => !Number.isFinite(coefficient))) invalid('영점·극점의 gain 적용 계수는 유한해야 합니다.');
      proper(numerator, polynomial(poles)); break;
    }
    case 'continuous.pid': if (!Number.isFinite((p.kp as number) + (p.kd as number) * (p.filterN as number))) invalid('PID의 direct feedthrough 배율은 유한해야 합니다.'); break;
    case 'nonlinear.relay': if ((p.offThreshold as number) >= (p.onThreshold as number)) invalid('Relay의 offThreshold는 onThreshold보다 작아야 합니다.'); break;
  }
}

/** Seed state outputs, then infer algebraic domains without introducing state dependency cycles. */
export function inferContinuousDomains(model: CalcModel, ordered: IRNode[]): void {
  if (model.execution.mode !== 'continuous') return;
  const byId = new Map(ordered.map((node) => [node.id, node]));
  const explicit = new Map(model.nodes.map((node) => [node.id, !!node.sampleTime && (node.sampleTime.period !== 1 || node.sampleTime.offset !== 0)]));
  for (const node of ordered) {
    if (getBlockDefinition(node.blockType)!.sampleTime === 'constant' || node.blockType.startsWith('annotation.')) node.executionDomain = 'constant';
    else if (node.blockType === 'source.dataset') node.executionDomain = node.parameters.dataKind === 'boolean' ? 'discrete' : 'continuous';
    else if (node.blockType.startsWith('discrete.') || sampled.has(node.blockType)) node.executionDomain = 'discrete';
    else if (CONTINUOUS_STATE_TYPES.includes(node.blockType) || CONTINUOUS_BOUNDARY_TYPES.includes(node.blockType) || continuousSources.has(node.blockType)) node.executionDomain = 'continuous';
    else if (explicit.get(node.id)) node.executionDomain = 'discrete';
  }
  for (const node of ordered) {
    if (node.executionDomain === undefined) {
      const domains = Object.values(node.inputs).map((endpoint) => byId.get(endpoint.nodeId)!.executionDomain);
      node.executionDomain = domains.includes('continuous') ? 'continuous' : domains.includes('discrete') ? 'discrete' : 'continuous';
      // Inherit a single discrete input rate unless the editor explicitly supplied another one.
      if (node.executionDomain === 'discrete') {
        const source = Object.values(node.inputs).map((endpoint) => byId.get(endpoint.nodeId)!).find((producer) => producer.executionDomain === 'discrete');
        if (!explicit.get(node.id) && source) node.sampleTime = { ...source.sampleTime };
      }
    }
    if (node.executionDomain === 'continuous' && !boundary.has(node.blockType) && (node.sampleTime.period !== 1 || node.sampleTime.offset !== 0)) fail(node, 'UNSUPPORTED_SAMPLE_TIME', '연속 상태·시간 입력에는 기본 샘플시간 1/0만 사용할 수 있습니다.');
  }
  const solver = normalizeSolverSettings(model.execution);
  const hasDiscrete = ordered.some((node) => node.executionDomain === 'discrete' || boundary.has(node.blockType));
  if (hasDiscrete && (model.execution.stopTime - model.execution.startTime) / solver.discreteStep > MODEL_LIMITS.maxSteps) throw new ModelError([{ code: 'DISCRETE_STEP_BUDGET_EXCEEDED', message: '혼합 실행의 이산 base tick은 10,000개 구간 이하여야 합니다.' }]);
  for (const node of ordered) {
    for (const [portId, endpoint] of Object.entries(node.inputs)) {
      const source = byId.get(endpoint.nodeId)!;
      if (portId === 'reset' && node.blockType === 'continuous.integrator') {
        if (source.blockType !== 'logic.hit-crossing' && source.executionDomain !== 'discrete' && source.executionDomain !== 'constant') fail(node, 'UNSUPPORTED_RESET_EVENT', 'rising 초기화는 Hit Crossing 출력 또는 이산·상수 boolean 제어 신호를 사용해 주세요.', portId);
        continue;
      }
      if (portId === 'call' && node.blockType === 'hierarchy.function-call' && node.parameters.callEventRate) continue;
      if (node.executionDomain === 'discrete' && source.executionDomain === 'continuous' && !boundary.has(node.blockType)) fail(node, 'HYBRID_BOUNDARY_REQUIRED', '연속 신호를 이산 입력에 연결하려면 Zero Order Hold를 사용해 샘플 경계를 명시해 주세요.', portId);
      if (node.executionDomain === 'discrete' && source.executionDomain === 'discrete' && node.blockType !== 'time.rate-transition' && !boundary.has(node.blockType) && (source.sampleTime.period !== node.sampleTime.period || source.sampleTime.offset !== node.sampleTime.offset)) fail(node, 'SAMPLE_TIME_MISMATCH', '서로 다른 이산 샘플시간 사이에는 Rate Transition이 필요합니다.', portId);
      // Reset ports are event controls; they do not impose current-output dependency or rate conversion.
    }
  }
  validateRegisteredDiscontinuities(ordered, byId);
  validateContinuousCaptureDependencies(model, ordered, byId);
}

/** Holds sample current due inputs, so their capture graph is stricter than the stage-output DAG. */
function validateContinuousCaptureDependencies(model: CalcModel, nodes: IRNode[], byId: Map<string, IRNode>): void {
  const holds = nodes.filter((node) => boundary.has(node.blockType));
  if (!holds.length) return;
  const ids = [...byId.keys()].sort();
  const adjacency = new Map(ids.map((id) => [id, [] as string[]]));
  for (const target of nodes) {
    if (!boundary.has(target.blockType) && !isDirectFeedthrough(target)) continue;
    for (const [port, endpoint] of Object.entries(target.inputs)) {
      if (boundary.has(target.blockType) ? port !== 'reset' : getDirectFeedthroughPorts(target).includes(port)) adjacency.get(endpoint.nodeId)!.push(target.id);
    }
  }
  for (const targets of adjacency.values()) targets.sort();
  let visits = 0;
  const charge = (): void => {
    if (++visits > 50_000_000) throw new ModelError([{ code: 'CAPTURE_GRAPH_BUDGET', message: '동시 홀드 캡처 의존성 검사의 50,000,000회 작업 한도를 초과했습니다. 캡처 피드백 경로·블럭 수나 이산 tick 수를 줄여 주세요.' }]);
  };
  const due = (node: IRNode, tick: number): boolean => tick >= node.sampleTime.offset && (tick - node.sampleTime.offset) % node.sampleTime.period === 0;
  const cycle = (tick?: number): string[] | undefined => {
    const color = new Map<string, 1 | 2>();
    const stack: { id: string; next: number }[] = [];
    for (const root of ids) {
      charge();
      if (color.has(root)) continue;
      color.set(root, 1); stack.push({ id: root, next: 0 });
      while (stack.length) {
        const frame = stack[stack.length - 1]!, targets = adjacency.get(frame.id)!;
        if (frame.next >= targets.length) { color.set(frame.id, 2); stack.pop(); continue; }
        charge();
        const targetId = targets[frame.next++]!, target = byId.get(targetId)!;
        // Not-due held outputs use previously published values and break current capture dependency.
        if (tick !== undefined && (boundary.has(target.blockType) || target.executionDomain === 'discrete') && !due(target, tick)) continue;
        if (color.get(targetId) === 1) {
          const start = stack.findIndex((entry) => entry.id === targetId);
          return stack.slice(start).map((entry) => entry.id).concat(targetId);
        }
        if (!color.has(targetId)) { color.set(targetId, 1); stack.push({ id: targetId, next: 0 }); }
      }
    }
    return undefined;
  };
  // The common feed-forward case needs one graph walk regardless of run duration.
  if (!cycle()) return;
  const solver = normalizeSolverSettings(model.execution);
  const lastTick = Math.floor((model.execution.stopTime - model.execution.startTime) / solver.discreteStep + 1e-9);
  for (let tick = 0; tick <= lastTick; tick += 1) {
    if (!holds.some((hold) => { charge(); return due(hold, tick); })) continue;
    const path = cycle(tick);
    if (!path) continue;
    const shown = path.slice(0, 12).join(' → ') + (path.length > 12 ? ' → …' : '');
    const time = model.execution.startTime + tick * solver.discreteStep;
    throw new ModelError([...new Set(path)].slice(0, 20).map((nodeId) => ({ code: 'CYCLIC_CAPTURE_DEPENDENCY', nodeId, message: `동일 시각의 현재 입력을 서로 요구하는 홀드 캡처 순환입니다: ${shown}. 이산 tick ${tick}, t=${time} s. Unit Delay·Rate Transition·Memory 또는 실제 direct feedthrough가 없는 상태 출력을 사용해 인과적 경계를 명시해 주세요.` })));
  }
}

/** Unregistered jumps must not silently cross an integration step. Raw sampled sinks remain valid. */
function validateRegisteredDiscontinuities(ordered: IRNode[], byId: Map<string, IRNode>): void {
  const roundedExpression = (ast: ExpressionNode | undefined): boolean => {
    if (!ast) return false;
    if (ast.type === 'call') return ['floor', 'ceil', 'round', 'trunc'].includes(ast.name) || ast.args.some(roundedExpression);
    if (ast.type === 'binary') return roundedExpression(ast.left) || roundedExpression(ast.right);
    if (ast.type === 'unary') return roundedExpression(ast.argument);
    return false;
  };
  const changingMemo = new Map<string, boolean>();
  const changesContinuously = (node: IRNode, seen = new Set<string>()): boolean => {
    if (node.executionDomain !== 'continuous' || CONTINUOUS_BOUNDARY_TYPES.includes(node.blockType)) return false;
    if (changingMemo.has(node.id)) return changingMemo.get(node.id)!;
    if (seen.has(node.id)) return true;
    const next = new Set(seen).add(node.id);
    const changing = CONTINUOUS_STATE_TYPES.includes(node.blockType) || continuousSources.has(node.blockType) || Object.values(node.inputs).some((endpoint) => changesContinuously(byId.get(endpoint.nodeId)!, next));
    changingMemo.set(node.id, changing); return changing;
  };
  for (const node of ordered) {
    const dtype = node.outputs.out?.typed?.dtype;
    const quantizingCast = ['signal.cast', 'signal.cast-inherited'].includes(node.blockType) && dtype !== 'float64' && dtype !== 'complex128';
    const quantizingMath = node.blockType === 'typed.math' && dtype !== 'float64' && dtype !== 'complex128';
    const sampledBits = ['logic.bit-mask', 'logic.extract-bits', 'logic.float-extract-bits', 'logic.integer-to-bits', 'logic.bits-to-integer', 'logic.shift-arithmetic', 'logic.bitwise-typed', 'fixed.integer-increment', 'fixed.trigonometric'].includes(node.blockType);
    if ((quantizingCast || quantizingMath || sampledBits) && changesContinuously(node)) fail(node, 'TYPED_CONTINUOUS_BOUNDARY_REQUIRED', '자료형 양자화·비트·fixed LUT 연산의 입력은 상수 또는 이산 held 신호여야 합니다. 연속 입력에는 Zero Order Hold를 연결해 샘플 경계를 지정해 주세요.');
  }
  for (const state of ordered.filter((node) => CONTINUOUS_STATE_TYPES.includes(node.blockType))) {
    const pending = state.inputs.in ? [state.inputs.in.nodeId] : [];
    const seen = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue; seen.add(id);
      const producer = byId.get(id)!;
      if (producer.executionDomain !== 'continuous' || CONTINUOUS_STATE_TYPES.includes(producer.blockType) || CONTINUOUS_BOUNDARY_TYPES.includes(producer.blockType)) continue;
      let unsupported = m8HasUnregisteredJump(producer) || producer.blockType === 'math.round'
        || ['math.sign', 'math.mod', 'math.remainder', 'nonlinear.quantizer', 'logic.interval', 'logic.is-integer', 'logic.approx-equal', 'reduce.all', 'reduce.any'].includes(producer.blockType)
        || (producer.blockType === 'lookup.interpolated' && producer.parameters.interpolation === 'previous')
        || (producer.blockType === 'math.expression' && roundedExpression(producer.expression));
      if (producer.blockType === 'route.switch') {
        const condition = byId.get(producer.inputs.condition!.nodeId)!;
        unsupported ||= condition.executionDomain === 'continuous' && condition.blockType !== 'logic.hit-crossing';
      }
      unsupported ||= m8JumpControlPorts(producer).some(port => changesContinuously(byId.get(producer.inputs[port]!.nodeId)!));
      if (unsupported && changesContinuously(producer)) fail(producer, 'UNREGISTERED_DISCONTINUITY', '이 연속 불연속 연산의 전환 위치는 현재 솔버가 추적하지 않습니다. Zero Order Hold를 사용해 이산 연산으로 실행하거나 등록된 Step·Relay·Hit Crossing 사건을 사용해 주세요.');
      pending.push(...Object.values(producer.inputs).map((endpoint) => endpoint.nodeId));
    }
  }
}
