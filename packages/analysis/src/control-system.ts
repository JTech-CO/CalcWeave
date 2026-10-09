import { ModelError } from '../../model/src';
import { analyzeStateSpaceSiso, matrix, plain, array, type ControlStateSpace, type ControlAnalysisSpec, type ControlAnalysisReport } from './control-analysis-internal';
export { CONTROL_LIMITS } from './control-analysis-internal';
export type { ComplexValue, ControlStateSpace, ControlAnalysisSpec, FrequencyPoint, GainCrossover, PhaseCrossover, ControlMargins, RootLocusPoint, ControlAnalysisReport } from './control-analysis-internal';
const fail = (code: string, message: string): never => { throw new ModelError([{ code, message }]); };

function validateStateSpace(value: unknown): ControlStateSpace {
  plain(value, ['A', 'B', 'C', 'D', 'domain']);
  const source = value as ControlStateSpace;
  if (source.domain !== undefined && source.domain !== 'continuous') fail('CONTROL_DOMAIN', '연속 시간 상태공간만 분석합니다. 이산·descriptor 행렬은 자동 변환하지 않습니다.');
  const A = matrix(source.A), B = matrix(source.B), C = matrix(source.C), D = matrix(source.D), n = A.length;
  if (A.some((row) => row.length !== n) || B.length !== n || B.some((row) => row.length !== 1) || C.length !== 1 || C[0]!.length !== n || D.length !== 1 || D[0]!.length !== 1) fail('CONTROL_SISO', '1~4차 SISO 상태공간 A(n×n), B(n×1), C(1×n), D(1×1)이 필요합니다. MIMO 채널·고차 모델은 자동 축소하지 않습니다.');
  return { A, B, C, D, domain: 'continuous' };
}
/** Read the actual M12 bus without invoking accessors or coercing typed/string data. */
export function readLinearizationStateSpace(value: unknown): ControlStateSpace {
  plain(value, ['kind', 'fields'], 'CONTROL_LINEARIZATION_BUS');
  const bus = value as { kind: unknown; fields: unknown[] };
  if (bus.kind !== 'bus') fail('CONTROL_LINEARIZATION_BUS', '실제로 기록된 A/B/C/D 선형화 bus가 필요합니다.');
  array(bus.fields, 4, 4, 'CONTROL_LINEARIZATION_BUS');
  const fields: Partial<Record<'A' | 'B' | 'C' | 'D', unknown>> = {};
  for (const value of bus.fields) {
    plain(value, ['name', 'value'], 'CONTROL_LINEARIZATION_BUS');
    const field = value as { name: string; value: unknown };
    if (!['A', 'B', 'C', 'D'].includes(field.name) || Object.hasOwn(fields, field.name)) fail('CONTROL_LINEARIZATION_BUS', '선형화 bus에는 고유한 A/B/C/D 필드 네 개가 필요합니다.');
    fields[field.name as 'A' | 'B' | 'C' | 'D'] = field.value;
  }
  return validateStateSpace(fields);
}
/** Analyze a supplied continuous SISO local matrix snapshot as open-loop L(s). */
export function analyzeContinuousSiso(input: ControlStateSpace, spec: ControlAnalysisSpec = {}): ControlAnalysisReport {
  return analyzeStateSpaceSiso(validateStateSpace(input), spec, { domain: 'continuous' });
}
