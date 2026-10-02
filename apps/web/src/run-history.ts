import { parseModel, canonicalSemantic, ModelError, UNITS, type CalcModel, type RunResult, type SignalDescriptor } from '../../../packages/model/src';
import { sha256 } from '../../../packages/codegen-ts/src/sha256';
import type { ExportManifest } from '../../../packages/codegen-ts/src';

export const RUN_HISTORY_LIMITS = Object.freeze({ records: 5, bytes: 20 * 1024 * 1024, recordedValues: 200_000 });
const allowedUnits = new Set<string>(UNITS);
export interface HistoryRecord {
  id: string; label: string; createdAt: string; model: CalcModel; semanticHash: string; engineVersion: string;
  manifest: ExportManifest; result: RunResult; outputIds: string[]; outputTypes: Record<string, SignalDescriptor>;
}
export function historySnapshot(record: HistoryRecord): HistoryRecord {
  return validateRunHistory([record])[0]!;
}
export function validateRunHistory(raw: unknown): HistoryRecord[] {
  const invalid = (message: string): never => { throw new ModelError([{ code: 'INVALID_RUN_HISTORY', message }]); };
  if (!Array.isArray(raw) || raw.length > RUN_HISTORY_LIMITS.records) invalid('실행 기록 형식이나 보관 개수가 올바르지 않습니다. 원본은 유지됩니다.');
  let values = 0; const active = new Set<object>();
  const walk = (value: unknown, depth = 0): void => {
    if (++values > 3_000_000 || depth > 40) invalid('실행 기록의 구조 상한을 초과했습니다.');
    if (typeof value === 'number' && !Number.isFinite(value) || typeof value === 'string' && value.length > RUN_HISTORY_LIMITS.bytes) invalid('실행 기록에 유효하지 않은 값이 있습니다.');
    if (value && typeof value === 'object') {
      if (active.has(value)) invalid('실행 기록에 순환 구조가 있습니다.'); active.add(value);
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) invalid('실행 기록에는 JSON 객체만 사용할 수 있습니다.');
      if (Object.getOwnPropertySymbols(value).length) invalid('실행 기록에 숨김 속성이 있습니다.');
      const descriptors = Object.getOwnPropertyDescriptors(value), entries: unknown[] = [];
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (Array.isArray(value) && key === 'length') continue;
        if (!('value' in descriptor) || !descriptor.enumerable) invalid('실행 기록에는 접근자나 숨김 속성을 사용할 수 없습니다.');
        entries.push(descriptor.value);
      }
      if (entries.length > 200_000) invalid('실행 기록의 배열 상한을 초과했습니다.'); entries.forEach(item => walk(item, depth + 1)); active.delete(value);
    } else if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) invalid('실행 기록에 지원하지 않는 값이 있습니다.');
  };
  walk(raw);
  const serialized = JSON.stringify(raw);
  if (new TextEncoder().encode(serialized).length > RUN_HISTORY_LIMITS.bytes) invalid('실행 기록은 전체 20 MiB 이하여야 합니다.');
  const detached = JSON.parse(serialized) as HistoryRecord[];
  const ids = new Set<string>();
  for (const record of detached) {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string' || !/^[\w-]{1,64}$/.test(record.id) || ids.has(record.id)) invalid('실행 기록 ID가 올바르지 않습니다.'); ids.add(record.id);
    if (typeof record.label !== 'string' || record.label.length > 100 || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))) invalid('실행 기록 이름이나 시각을 확인해 주세요.');
    if (!/^[a-f0-9]{64}$/.test(record.semanticHash) || typeof record.engineVersion !== 'string' || record.engineVersion.length > 64 || record.manifest?.modelHash !== record.semanticHash || record.manifest.engineVersion !== record.engineVersion) invalid('실행 기록의 hash와 manifest가 일치하지 않습니다.');
    record.model = parseModel(record.model);
    if (sha256(canonicalSemantic(record.model)) !== record.semanticHash) invalid('실행 기록의 모델 스냅샷과 hash가 다릅니다. 원본은 유지됩니다.');
    const result = record.result;
    if (JSON.stringify(record.manifest.outputTypes) !== JSON.stringify(record.outputTypes)) invalid('실행 기록의 출력 자료형과 manifest가 다릅니다.');
    if (!result || !['completed', 'cancelled', 'failed'].includes(result.status) || !Array.isArray(result.samples) || result.samples.length > 10001 || result.steps !== result.samples.length || !Array.isArray(record.outputIds) || record.outputIds.length > 1000 || !record.outputTypes || typeof record.outputTypes !== 'object') invalid('실행 기록 결과 형식을 확인해 주세요.');
    if (new Set(record.outputIds).size !== record.outputIds.length || record.outputIds.some(id => typeof id !== 'string' || id.length > 1024 || !Object.hasOwn(record.outputTypes, id))) invalid('기록된 출력 연결이 올바르지 않습니다.');
    for (const descriptor of Object.values(record.outputTypes)) {
      if (!descriptor || !['float64', 'boolean'].includes(descriptor.valueType) || !Array.isArray(descriptor.shape) || descriptor.shape.length > 2 || descriptor.shape.some(size => !Number.isInteger(size) || size < 1 || size > 1024) || !allowedUnits.has(descriptor.unit) || descriptor.fields && (!Array.isArray(descriptor.fields) || descriptor.fields.length > 16 || descriptor.fields.some(field => typeof field !== 'string' || field.length > 64))) invalid('기록된 출력 자료형이 올바르지 않습니다.');
    }
    let elements = 0;
    const count = (value: unknown): number => Array.isArray(value) ? value.reduce((sum, item) => sum + count(item), 0) : typeof value === 'number' || typeof value === 'boolean' ? 1 : invalid('기록된 신호의 자료형이 올바르지 않습니다.');
    let previous = -Infinity;
    for (const sample of result.samples) {
      if (!sample || typeof sample.time !== 'number' || !Number.isFinite(sample.time) || sample.time < previous || !sample.values || typeof sample.values !== 'object') invalid('기록된 시간 격자가 올바르지 않습니다.'); previous = sample.time;
      elements += 1 + Object.values(sample.values).reduce<number>((sum, value) => sum + count(value), 0);
      if (elements > RUN_HISTORY_LIMITS.recordedValues) invalid('한 실행 기록은 200,000개의 수치·boolean 원소 이하여야 합니다.');
    }
    if (!Number.isFinite(result.elapsedMs) || result.elapsedMs < 0 || !result.finalState || typeof result.finalState !== 'object') invalid('최종 실행 상태가 올바르지 않습니다.');
  }
  return detached;
}
export function appendHistory(records: HistoryRecord[], record: HistoryRecord): HistoryRecord[] {
  const next = [historySnapshot(record), ...records.filter(existing => existing.id !== record.id)].slice(0, RUN_HISTORY_LIMITS.records);
  // Evict the oldest complete record, never truncate raw arrays within a record.
  while (next.length && new TextEncoder().encode(JSON.stringify(next)).length > RUN_HISTORY_LIMITS.bytes) next.pop();
  return validateRunHistory(next);
}
