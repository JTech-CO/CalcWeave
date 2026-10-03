import type { ExecutionSettings, SolverSettings } from '../../../packages/model/src';

export function solverMethodLabel(method: string): string {
  return ({ rk4: 'RK4', rk45: 'RK45', 'implicit-euler': '암시적 Euler' } as Record<string, string>)[method] ?? method;
}

/** User method changes remove IE-only settings before returning to a legacy RK method. */
export function solverSettingsForMethod(execution: ExecutionSettings, method: SolverSettings['method']): Partial<SolverSettings> {
  const { newtonTolerance, newtonMaxIterations, jacobianStep, ...shared } = execution.solver ?? {};
  return { ...shared, method, ...(method === 'implicit-euler' ? {
    newtonTolerance: newtonTolerance ?? 1e-9,
    newtonMaxIterations: newtonMaxIterations ?? 24,
    jacobianStep: jacobianStep ?? 1e-6,
  } : {}) };
}

const EVENT_LABELS: Record<string, string> = { crossing: '경계 통과', reset: '초기값 reset', relay: 'Relay 전환', limit: '상태 경계 도달', backlash: '백래시 경계', linearization: '국소 선형화', rate: '변화율 경계' };
export function solverEventLabel(kind: string): string { return EVENT_LABELS[kind] ?? kind; }
