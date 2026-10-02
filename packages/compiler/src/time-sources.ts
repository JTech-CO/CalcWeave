import { isExpandedTimeSource } from '../../block-library/src/time-sources';
import { MODEL_LIMITS, ModelError, type CalcModel, type IRNode, type SignalDescriptor } from '../../model/src';

export function validateTimeSourceParameters(node: IRNode, _model: CalcModel): void {
  if (!isExpandedTimeSource(node.blockType)) return;
  const p = node.parameters;
  const invalid = (): never => { throw new ModelError([{ code: 'INVALID_PARAMETERS', nodeId: node.id, message: '시간 신호의 폭·기간은 양수이고 중심 시각은 지원 시간 범위 안에 있어야 합니다.' }]); };
  if (p.center !== undefined && (typeof p.center !== 'number' || !Number.isFinite(p.center) || Math.abs(p.center) > MODEL_LIMITS.maxTime)) invalid();
  for (const key of ['width', 'duration']) if (p[key] !== undefined && (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || p[key] <= 0 || p[key] > MODEL_LIMITS.maxTime)) invalid();
}

export function inferTimeSourceDescriptor(node: IRNode, declaredUnit: string): SignalDescriptor | undefined {
  return isExpandedTimeSource(node.blockType) ? { valueType: 'float64', shape: [], unit: declaredUnit } : undefined;
}
