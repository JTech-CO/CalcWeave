import { MODEL_LIMITS, ModelError, signalElementCount, validateSignal, type CompiledModel, type Diagnostic, type RunResult } from '../../model/src';
import type { SweepBudget } from './index';

export function fail(code: string, message: string): never { throw new ModelError([{ code, message }]); }
export function plainOptions(input: unknown, allowed: readonly string[], code: string): void {
  if (input === null || typeof input !== 'object' || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) fail(code, '지원하는 일반 옵션 객체를 사용해 주세요.');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || !allowed.includes(key) || !('value' in descriptors[key]!) || !descriptors[key]!.enumerable)) fail(code, '지원하지 않는 옵션·접근자·숨김 필드가 있습니다.');
}

export function diagnosticsFor(error: unknown): Diagnostic[] {
  if (!(error instanceof ModelError)) return [{ code: 'SWEEP_EXECUTION_FAILED', message: '반복 실행 중 오류가 발생했습니다.' }];
  return error.diagnostics.slice(0, 20).map((diagnostic) => ({ ...diagnostic, code: String(diagnostic.code).slice(0, 100), message: String(diagnostic.message).slice(0, 2_000) }));
}

export function freezeSnapshot<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

/** Inspect JSON-like executor output before copying it, without invoking getters or hooks. */
function snapshotResult(result: unknown, maxRecordedValues: number): RunResult {
  const pending: { value: unknown; depth: number; leave?: boolean }[] = [{ value: result, depth: 0 }];
  const seen = new WeakSet<object>();
  let visited = 0;
  const maxValues = maxRecordedValues * 4 + MODEL_LIMITS.maxStateElements * 8 + 10_000;
  while (pending.length) {
    const { value, depth, leave } = pending.pop()!;
    if (leave) { seen.delete(value as object); continue; }
    if (++visited > maxValues || depth > 40) fail('SWEEP_RESOURCE_REPORT', '실행 결과의 크기 또는 중첩 깊이가 허용 상한을 초과했습니다.');
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail('SWEEP_RESOURCE_REPORT', '실행 결과의 숫자는 유한해야 합니다.'); continue; }
    if (typeof value === 'string') { if (value.length > 4_096) fail('SWEEP_RESOURCE_REPORT', '실행 결과의 문자열이 너무 깁니다.'); continue; }
    if (value === null || typeof value === 'boolean') continue;
    if (typeof value !== 'object') fail('SWEEP_RESOURCE_REPORT', '실행 결과는 JSON 값만 포함할 수 있습니다.');
    if (seen.has(value)) fail('SWEEP_RESOURCE_REPORT', '실행 결과에는 순환 객체 참조를 사용할 수 없습니다.');
    seen.add(value);
    pending.push({ value, depth, leave: true });
    const array = Array.isArray(value);
    if ((array && Object.getPrototypeOf(value) !== Array.prototype) || (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail('SWEEP_RESOURCE_REPORT', '실행 결과는 일반 객체와 배열만 포함할 수 있습니다.');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length > maxValues || (array && value.length > maxRecordedValues + MODEL_LIMITS.maxStateElements)) fail('SWEEP_RESOURCE_REPORT', '실행 결과가 허용 상한을 초과했습니다.');
    if (array && Object.keys(descriptors).length !== value.length + 1) fail('SWEEP_RESOURCE_REPORT', '실행 결과 배열에는 빈 칸이나 추가 필드를 사용할 수 없습니다.');
    for (const key of Reflect.ownKeys(descriptors)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) fail('SWEEP_RESOURCE_REPORT', '실행 결과에 안전하지 않은 필드가 있습니다.');
      const descriptor = descriptors[key]!;
      if (!('value' in descriptor) || !descriptor.enumerable) fail('SWEEP_RESOURCE_REPORT', '실행 결과에 접근자나 숨김 필드를 사용할 수 없습니다.');
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) fail('SWEEP_RESOURCE_REPORT', '실행 결과 배열에 잘못된 필드가 있습니다.');
      pending.push({ value: descriptor.value, depth: depth + 1 });
    }
  }
  return structuredClone(result) as RunResult;
}

export function validatedResult(result: unknown, compiled: CompiledModel, budget: SweepBudget): { result: RunResult; records: number; operations: number } {
  const snapshot = snapshotResult(result, budget.maxRecordedValues);
  if (!['completed', 'cancelled', 'failed'].includes(snapshot.status) || !Array.isArray(snapshot.samples)
    || !Number.isSafeInteger(snapshot.steps) || snapshot.steps !== snapshot.samples.length
    || !Number.isFinite(snapshot.elapsedMs) || snapshot.elapsedMs < 0
    || snapshot.finalState === null || typeof snapshot.finalState !== 'object' || Array.isArray(snapshot.finalState)
    || !snapshot.resources || !Number.isSafeInteger(snapshot.resources.operations) || snapshot.resources.operations < 0 || snapshot.resources.operations > budget.maxOperations) {
    fail('SWEEP_RESOURCE_REPORT', '실행 상태·표본 수·시간·연산 사용량 보고를 확인해 주세요.');
  }
  if (snapshot.status === 'completed' && compiled.nodes.length && snapshot.resources.operations === 0) fail('SWEEP_RESOURCE_REPORT', '계산을 완료한 실행은 실제 연산 사용량을 보고해야 합니다.');
  const expectedSamples = compiled.model.execution.mode === 'static' ? 1 : Math.round((compiled.model.execution.stopTime - compiled.model.execution.startTime) / compiled.model.execution.step) + 1;
  if (snapshot.samples.length > expectedSamples || (snapshot.status === 'completed' && snapshot.samples.length !== expectedSamples)) fail('SWEEP_RESOURCE_REPORT', '실행 표본 수가 모델의 시간축과 다릅니다.');
  let records = 0;
  for (const [index, sample] of snapshot.samples.entries()) {
    const expectedTime = compiled.model.execution.startTime + index * compiled.model.execution.step;
    if (typeof sample.time !== 'number' || Math.abs(sample.time - expectedTime) > 1e-10 * Math.max(1, Math.abs(expectedTime))
      || sample.values === null || typeof sample.values !== 'object' || Array.isArray(sample.values)
      || Object.keys(sample.values).length !== compiled.outputIds.length) fail('SWEEP_RESOURCE_REPORT', '실행 결과의 시간축과 출력 목록을 확인해 주세요.');
    records += 1; // Every timestamp consumes the shared recording budget, including sink-free runs.
    for (const id of compiled.outputIds) {
      if (!Object.hasOwn(sample.values, id)) fail('SWEEP_RESOURCE_REPORT', '실행 결과에 지정된 출력 신호가 없습니다.');
      let actual;
      try { actual = validateSignal(sample.values[id]); } catch { fail('SWEEP_RESOURCE_REPORT', '실행 출력의 값과 형상을 확인해 주세요.'); }
      const expected = compiled.outputTypes[id]!;
      if (actual.valueType !== expected.valueType || actual.shape.length !== expected.shape.length || actual.shape.some((size, axis) => size !== expected.shape[axis])) fail('SWEEP_RESOURCE_REPORT', '실행 출력의 자료형 또는 형상이 컴파일 결과와 다릅니다.');
      records += signalElementCount(actual);
    }
    if (records > budget.maxRecordedValues) fail('SWEEP_RESOURCE_REPORT', '실행 결과가 남은 공유 기록 한도를 초과했습니다.');
  }
  return { result: snapshot, records, operations: snapshot.resources.operations };
}
