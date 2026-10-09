import { ModelError } from '../../model/src';
import { analyzeStateSpaceSiso, matrix, plain, type ControlAnalysisReport, type ControlAnalysisSpec, type SisoMatrices } from './control-analysis-internal';

export const DISCRETE_CONTROL_LIMITS = Object.freeze({ minSampleTime: 1e-9, maxSampleTime: 1e9 });
export interface DiscreteControlStateSpace extends SisoMatrices { domain: 'discrete'; sampleTime: number }
export interface DiscreteControlAnalysisReport extends Omit<ControlAnalysisReport, 'stateSpace'> {
  stateSpace: DiscreteControlStateSpace;
  domain: 'discrete';
  sampleTime: number;
  nyquistOmega: number;
  stabilityCriterion: 'unit-circle';
}
const fail = (code: string, message: string): never => { throw new ModelError([{ code, message }]); };

/** Explicit seconds/sample and bounded plain SISO matrices; no time-domain conversion. */
export function readDiscreteStateSpace(value: unknown): DiscreteControlStateSpace {
  plain(value, ['A', 'B', 'C', 'D', 'domain', 'sampleTime']);
  const source = value as DiscreteControlStateSpace;
  if (source.domain !== 'discrete') fail('CONTROL_DOMAIN', '이산 시간 domain과 명시된 샘플 주기가 필요합니다. 연속계 행렬을 자동 변환하지 않습니다.');
  if (typeof source.sampleTime !== 'number' || !Number.isFinite(source.sampleTime) || source.sampleTime < DISCRETE_CONTROL_LIMITS.minSampleTime || source.sampleTime > DISCRETE_CONTROL_LIMITS.maxSampleTime) fail('CONTROL_SAMPLE_TIME', '샘플 주기는 10⁻⁹~10⁹초의 유한한 실수여야 합니다.');
  const A = matrix(source.A), B = matrix(source.B), C = matrix(source.C), D = matrix(source.D), n = A.length;
  if (A.some((row) => row.length !== n) || B.length !== n || B.some((row) => row.length !== 1) || C.length !== 1 || C[0]!.length !== n || D.length !== 1 || D[0]!.length !== 1) fail('CONTROL_SISO', '1~4차 SISO 상태공간 A(n×n), B(n×1), C(1×n), D(1×1)이 필요합니다. MIMO 채널·고차 모델은 자동 축소하지 않습니다.');
  return { A, B, C, D, domain: 'discrete', sampleTime: source.sampleTime };
}

/** Analyze the supplied open-loop L(z) on z=exp(jωTs), with ω in physical rad/s. */
export function analyzeDiscreteSiso(input: DiscreteControlStateSpace, spec: ControlAnalysisSpec = {}): DiscreteControlAnalysisReport {
  const stateSpace = readDiscreteStateSpace(input);
  const report = analyzeStateSpaceSiso(stateSpace, spec, { domain: 'discrete', sampleTime: stateSpace.sampleTime });
  return { ...report, domain: 'discrete', sampleTime: stateSpace.sampleTime, nyquistOmega: Math.PI / stateSpace.sampleTime, stabilityCriterion: 'unit-circle' };
}
