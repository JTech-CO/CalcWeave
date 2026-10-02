import { ModelError, type ExecutionSettings, type IRNode, type SolverSettings } from './types';

export const SOLVER_LIMITS = Object.freeze({
  minStep: 1e-12, maxStep: 1e9, minTolerance: 1e-12, maxTolerance: 1,
  maxSteps: 100_000, maxRejects: 10_000, maxEvaluations: 1_000_000,
  maxEvents: 10_000, minEventTolerance: 1e-12, maxEventTolerance: 1,
});

/** One bounded normalized solver contract shared by compiler, Worker, UI and exports. */
export function normalizeSolverSettings(execution: ExecutionSettings): SolverSettings {
  const defaults: SolverSettings = {
    method: 'rk4', initialStep: execution.step, minStep: Math.min(execution.step, 1e-8),
    maxStep: execution.step, atol: 1e-8, rtol: 1e-6,
    maxSteps: SOLVER_LIMITS.maxSteps, maxRejects: SOLVER_LIMITS.maxRejects,
    maxEvaluations: SOLVER_LIMITS.maxEvaluations, eventTolerance: 1e-8,
    maxEvents: SOLVER_LIMITS.maxEvents, discreteStep: execution.step,
  };
  const value = { ...defaults, ...execution.solver };
  const invalid = (message: string): never => { throw new ModelError([{ code: 'INVALID_SOLVER', message }]); };
  if (Object.keys(execution.solver ?? {}).some((key) => !Object.hasOwn(defaults, key))) invalid('지원하지 않는 솔버 필드입니다.');
  if (value.method !== 'rk4' && value.method !== 'rk45') invalid('솔버는 rk4 또는 rk45여야 합니다.');
  for (const key of ['initialStep', 'minStep', 'maxStep', 'discreteStep'] as const) {
    const min = key === 'discreteStep' ? 1e-9 : SOLVER_LIMITS.minStep;
    if (!Number.isFinite(value[key]) || value[key] < min || value[key] > SOLVER_LIMITS.maxStep) invalid(`${key}는 ${min}~${SOLVER_LIMITS.maxStep}의 유한한 양수여야 합니다.`);
  }
  if (value.minStep > value.initialStep || value.initialStep > value.maxStep) invalid('minStep ≤ initialStep ≤ maxStep이어야 합니다.');
  for (const key of ['atol', 'rtol'] as const) if (!Number.isFinite(value[key]) || value[key] < SOLVER_LIMITS.minTolerance || value[key] > SOLVER_LIMITS.maxTolerance) invalid(`${key} 허용오차는 1e-12~1이어야 합니다.`);
  if (!Number.isFinite(value.eventTolerance) || value.eventTolerance < SOLVER_LIMITS.minEventTolerance || value.eventTolerance > SOLVER_LIMITS.maxEventTolerance) invalid('eventTolerance는 1e-12~1이어야 합니다.');
  for (const key of ['maxSteps', 'maxRejects', 'maxEvaluations', 'maxEvents'] as const) {
    const min = key === 'maxRejects' ? 0 : 1;
    if (!Number.isSafeInteger(value[key]) || value[key] < min || value[key] > SOLVER_LIMITS[key]) invalid(`${key}는 ${min}~${SOLVER_LIMITS[key]}의 정수여야 합니다.`);
  }
  return value;
}

export const CONTINUOUS_STATE_TYPES: readonly string[] = Object.freeze([
  'continuous.integrator', 'continuous.second-order-integrator', 'continuous.state-space',
  'continuous.transfer-function', 'continuous.zero-pole', 'continuous.pid', 'continuous.derivative',
]);
export const CONTINUOUS_BOUNDARY_TYPES: readonly string[] = Object.freeze([
  'time.memory', 'time.zero-order-hold', 'time.first-order-hold', 'time.transport-delay',
  'logic.hit-crossing', 'nonlinear.relay',
]);
export function continuousStateElementCount(node: IRNode): number {
  switch (node.blockType) {
    case 'continuous.integrator': case 'continuous.derivative': return 1;
    case 'continuous.second-order-integrator': case 'continuous.pid': return 2;
    case 'continuous.state-space': case 'continuous.zero-pole': return (node.parameters.initial as number[]).length;
    case 'continuous.transfer-function': return (node.parameters.denominator as number[]).length - 1;
    case 'time.memory': case 'time.zero-order-hold': case 'logic.hit-crossing': case 'nonlinear.relay': return 1;
    case 'time.first-order-hold': return 5;
    default: return 0;
  }
}
