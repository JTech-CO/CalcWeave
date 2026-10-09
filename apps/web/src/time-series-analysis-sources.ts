import { compileModel } from '../../../packages/compiler/src';
import { ModelError, MODEL_LIMITS, type RunSample, type SignalDescriptor } from '../../../packages/model/src';
import { sha256 } from '../../../packages/model/src/sha256';
import { prepareScopeObservation, type ScopeObservationReport } from '../../../packages/analysis/src/scope-observation';
import type { TimeSeriesInput, CorrelationInput } from '../../../packages/analysis/src/time-series-statistics';
import type { ControlAnalysisRun } from './control-analysis-sources';

export const TIME_SERIES_SOURCE_LIMITS = Object.freeze({ sources: 16, recordedElements: 1_000_000 });
export interface TimeSeriesAnalysisSource {
  id: string; label: string; modelName: string; modelId: string; semanticHash: string;
  runStatus: 'completed'; outputId: string; unit: string; valueType: 'float64' | 'typed';
  shape: number[]; components: { index: number; label: string }[]; sampleCount: number;
}
export interface TimeSeriesSourceSnapshot extends TimeSeriesAnalysisSource {
  componentIndex: number; componentLabel: string; startIndex: number; count: number;
  startTime: number; endTime: number; samplesSha256: string;
}
export type TimeSeriesDraft = { startIndex: string; count: string; maxLag: string; minOverlap: string };

const RUN_KEYS = ['model', 'result', 'semanticHash'];
const RESULT_KEYS = ['samples', 'finalState', 'stateMemory', 'status', 'elapsedMs', 'stateTime', 'steps', 'solverStatistics', 'events', 'resources', 'stopReason', 'adapterLifecycle'];
function fail(message: string): never { throw new ModelError([{ code: 'TIME_SERIES_SOURCE', message }]); }
function object(input: unknown, maximum: number = MODEL_LIMITS.maxNodes, allowed?: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail('시계열 출처는 일반 데이터 객체여야 합니다.');
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
  if (keys.length > maximum || keys.some(key => typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || allowed && !allowed.includes(key) || !('value' in descriptors[key]!) || !descriptors[key]!.enumerable)) fail('시계열 출처의 크기·접근자·숨김·추가 속성을 확인하세요.');
  return Object.fromEntries(keys.map(key => [key, descriptors[key as string]!.value]));
}
function array(input: unknown, maximum: number): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > maximum) fail('시계열 기록 배열의 크기를 확인하세요.');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== input.length + 1) fail('시계열 기록에는 접근자·빈 칸·추가 속성을 허용하지 않습니다.');
  return Array.from({ length: input.length }, (_, index) => {
    const item = descriptors[String(index)];
    if (!item || !('value' in item) || !item.enumerable) fail('시계열 기록에는 접근자·빈 칸·추가 속성을 허용하지 않습니다.');
    return item.value as unknown;
  });
}
function errorMessage(error: unknown): string {
  return (error instanceof ModelError ? error.diagnostics[0]?.message : error instanceof Error ? error.message : '시계열 기록을 확인하세요.')?.slice(0, 300) ?? '시계열 기록을 확인하세요.';
}
function recorded(input: ControlAnalysisRun) {
  const run = object(input, 3, RUN_KEYS), compiled = compileModel(run.model as ControlAnalysisRun['model']);
  const semanticHash = sha256(compiled.semanticKey);
  if (run.semanticHash !== semanticHash) fail('실행 모델과 시계열 기록의 계산 지문이 다릅니다.');
  const execution = compiled.model.execution;
  if (execution.mode === 'static') fail('시계열 분석에는 완료된 시간 시뮬레이션이 필요합니다.');
  const result = object(run.result, RESULT_KEYS.length, RESULT_KEYS);
  if (result.status !== 'completed') fail('시계열 분석에는 완료된 실행 기록이 필요합니다. 부분·실패 기록은 분석하지 않습니다.');
  const raw = array(result.samples, MODEL_LIMITS.maxSteps + 1);
  if (raw.length < 2 || result.steps !== raw.length) fail('시간 기록은 표본 수가 일치하는 2개 이상의 표본이어야 합니다.');
  const intervals = Math.round((execution.stopTime - execution.startTime) / execution.step);
  if (raw.length !== intervals + 1) fail('완료 기록의 표본 수가 실행 모델의 시간 격자와 다릅니다.');
  let recordedKeys = 0;
  const samples = raw.map((item, index): RunSample => {
    const sample = object(item, 2, ['time', 'values']), time = sample.time;
    const expected = execution.startTime + index * execution.step;
    const tolerance = Math.min(execution.step / 8, Math.max(1e-12, 8 * Number.EPSILON * Math.max(1, Math.abs(expected))));
    if (typeof time !== 'number' || !Number.isFinite(time) || Math.abs(time - expected) > tolerance) fail('시계열 기록의 시각이 실행 당시의 균일 관측 격자와 다릅니다.');
    const values = object(sample.values, MODEL_LIMITS.maxNodes, compiled.outputIds);
    recordedKeys += 1 + Object.keys(values).length;
    if (recordedKeys > TIME_SERIES_SOURCE_LIMITS.recordedElements) fail('시간과 출력의 전체 기록 원소는 1,000,000개 이하입니다.');
    return { time, values: values as RunSample['values'] };
  });
  return { compiled, samples, semanticHash };
}
function supported(descriptor: SignalDescriptor): boolean {
  return descriptor.valueType === 'float64' || descriptor.valueType === 'typed' && ['float32', 'float64'].includes(descriptor.typed?.dtype ?? '') && descriptor.shape.length <= 1;
}
type RequestedComponent = { outputId: string; componentIndex: number };
const projectionKey = (outputId: string, componentIndex: number) => `${outputId}:${componentIndex}`;
function inspect(run?: ControlAnalysisRun | null, requested: RequestedComponent[] = []) {
  const sources: TimeSeriesAnalysisSource[] = [], issues: string[] = [], projections = new Map<string, ScopeObservationReport>();
  if (!run) return { sources, issues: ['시간 시뮬레이션을 완료한 뒤 기록의 시계열을 분석하세요.'], projections };
  const issue = (text: string) => { if (issues.length < 8 && !issues.includes(text)) issues.push(text); };
  try {
    const { compiled, samples, semanticHash } = recorded(run);
    let elements = 0;
    for (const outputId of compiled.outputIds) {
      const descriptor = compiled.outputTypes[outputId]!;
      if (!supported(descriptor)) { issue('정수·고정소수점·복소수·boolean·문자열·버스·메시지는 시계열 실수 입력으로 자동 변환하지 않습니다.'); continue; }
      if (sources.length === TIME_SERIES_SOURCE_LIMITS.sources) { issue('시계열 출력은 최대 16개까지 표시합니다.'); break; }
      const selected = [...new Set(requested.filter(item => item.outputId === outputId).map(item => item.componentIndex))];
      const components = selected.length ? selected : [0];
      // Each projection reads the full signal shape, including a second component from the same output.
      const cost = samples.length * (1 + descriptor.shape.reduce((product, size) => product * size, 1)) * components.length;
      if (elements + cost > TIME_SERIES_SOURCE_LIMITS.recordedElements) { issue('출력 투영의 전체 기록 원소는 1,000,000개 이하입니다. 큰 출력을 별도 모델로 기록하세요.'); continue; }
      elements += cost;
      let primary: ScopeObservationReport | undefined;
      for (const componentIndex of components) {
        const observation = prepareScopeObservation([{ id: 'time-series-run', label: compiled.model.name, samples, descriptor, status: 'completed' }], outputId, componentIndex);
        if (observation.status !== 'ready') { issue(observation.diagnostics.join(' · ') || '출력의 원시 기록을 확인하세요.'); primary = undefined; break; }
        primary = observation;
        if (selected.length) projections.set(projectionKey(outputId, componentIndex), observation);
      }
      if (!primary) continue;
      sources.push({ id: outputId, label: compiled.model.nodes.find(node => node.id === outputId)?.label ?? outputId,
        modelName: compiled.model.name, modelId: compiled.model.modelId, semanticHash, runStatus: 'completed', outputId,
        unit: descriptor.unit, valueType: descriptor.valueType as 'float64' | 'typed', shape: [...descriptor.shape],
        components: primary.components.map(component => ({ ...component })), sampleCount: samples.length });
    }
  } catch (error) { issue(errorMessage(error)); }
  return { sources, issues, projections };
}

/** Uses only bounded completed observations from their recorded model, never the current draft. */
export function timeSeriesAnalysisSources(run?: ControlAnalysisRun | null): { sources: TimeSeriesAnalysisSource[]; issues: string[] } {
  const { sources, issues } = inspect(run); return { sources, issues };
}
function validateSelection(outputId: string, componentIndex: number, startIndex: number, count: number): void {
  if (typeof outputId !== 'string' || !outputId.length || outputId.length > 160 || !Number.isSafeInteger(componentIndex) || componentIndex < 0 || !Number.isSafeInteger(startIndex) || startIndex < 0 || !Number.isSafeInteger(count) || count < 2 || count > 8192) fail('출력·성분·시작 표본과 2~8192의 정수 표본 수를 확인하세요.');
}
// These private copies keep the mutable-number[] core API while preventing later editing of a capture.
function immutableArray<T>(values: T[]): T[] { return Object.freeze(values) as unknown as T[]; }
function capture(available: ReturnType<typeof inspect>, outputId: string, componentIndex: number, startIndex: number, count: number): { source: TimeSeriesSourceSnapshot; input: TimeSeriesInput } {
  const source = available.sources.find(item => item.outputId === outputId);
  if (!source) fail(available.issues.join(' · ') || '분석 가능한 완료 출력 기록이 없습니다.');
  const component = source.components.find(item => item.index === componentIndex);
  if (!component || startIndex > source.sampleCount - count) fail('선택한 성분이나 표본 구간이 기록 범위를 벗어났습니다.');
  const projected = available.projections.get(projectionKey(outputId, componentIndex));
  if (!projected || projected.status !== 'ready') fail('선택한 성분의 원시 기록을 확인하세요.');
  const points = projected.curves[0]!.points.slice(startIndex, startIndex + count);
  if (points.some(point => point.value === null)) fail('선택한 표본 구간에 비유한 값이 있습니다. 값을 지우거나 보간해 분석하지 않습니다.');
  const input = Object.freeze({ times: immutableArray(points.map(point => point.time)), values: immutableArray(points.map(point => point.value!)) });
  const snapshot: TimeSeriesSourceSnapshot = { ...source, shape: immutableArray([...source.shape]),
    components: immutableArray(source.components.map(item => Object.freeze({ ...item }))), componentIndex, componentLabel: component.label,
    // Finite JSON numbers round-trip exactly except -0. A distinct token keeps its IEEE identity.
    startIndex, count, startTime: input.times[0]!, endTime: input.times[count - 1]!, samplesSha256: sha256(JSON.stringify(input, (_key, value: unknown) => typeof value === 'number' && Object.is(value, -0) ? '-0' : value)) };
  return { source: Object.freeze(snapshot), input };
}

/** Copies an explicit contiguous segment without interpolation, padding, casting or changing the recording. */
export function readTimeSeriesSelection(run: ControlAnalysisRun, outputId: string, componentIndex: number, startIndex: number, count: number): { source: TimeSeriesSourceSnapshot; input: TimeSeriesInput } {
  validateSelection(outputId, componentIndex, startIndex, count);
  return capture(inspect(run, [{ outputId, componentIndex }]), outputId, componentIndex, startIndex, count);
}
/** A correlation uses two components of the same completed recording and exactly equal raw timestamps and units. */
export function readCorrelationSelection(run: ControlAnalysisRun, xOutputId: string, xComponentIndex: number, yOutputId: string, yComponentIndex: number, startIndex: number, count: number): { xSource: TimeSeriesSourceSnapshot; ySource: TimeSeriesSourceSnapshot; input: CorrelationInput } {
  validateSelection(xOutputId, xComponentIndex, startIndex, count); validateSelection(yOutputId, yComponentIndex, startIndex, count);
  const available = inspect(run, [{ outputId: xOutputId, componentIndex: xComponentIndex }, { outputId: yOutputId, componentIndex: yComponentIndex }]);
  const x = capture(available, xOutputId, xComponentIndex, startIndex, count), y = capture(available, yOutputId, yComponentIndex, startIndex, count);
  if (x.source.unit !== y.source.unit) fail('상관 분석의 두 출력은 정확히 같은 단위여야 합니다. 단위를 자동 변환하지 않습니다.');
  if (x.input.times.length !== y.input.times.length || x.input.times.some((time, index) => !Object.is(time, y.input.times[index]))) fail('상관 분석의 원시 시각은 정확히 같아야 합니다. 시각을 자동 정렬하거나 보간하지 않습니다.');
  return { xSource: x.source, ySource: y.source, input: Object.freeze({ times: x.input.times, x: x.input.values, y: y.input.values }) };
}

export function defaultTimeSeriesDraft(sampleCount: number): TimeSeriesDraft {
  const available = Number.isSafeInteger(sampleCount) && sampleCount >= 0 && sampleCount <= MODEL_LIMITS.maxSteps + 1 ? sampleCount : 0;
  const count = Math.min(1024, available);
  return { startIndex: '0', count: String(count), maxLag: String(Math.max(0, Math.min(32, available - 1))), minOverlap: String(Math.min(available, Math.max(2, Math.ceil(count / 2)))) };
}
export function timeSeriesDraftSelection(input: TimeSeriesDraft, sampleCount: number): { startIndex: number; count: number; maxLag: number; minOverlap: number } {
  const draftError = (message: string): never => { throw new ModelError([{ code: 'TIME_SERIES_DRAFT', message }]); };
  let draft: Record<string, unknown>;
  try { draft = object(input, 4, ['startIndex', 'count', 'maxLag', 'minOverlap']); } catch { return draftError('분석 입력은 승인된 정수 텍스트 필드만 사용하세요.'); }
  function integer(value: unknown): number {
    if (typeof value !== 'string' || value.length > 100 || !/^(?:0|[1-9]\d*)$/.test(value.trim())) return draftError('분석 입력은 100자 이하의 정수 텍스트여야 합니다.');
    const parsed = Number(value.trim());
    if (!Number.isSafeInteger(parsed)) return draftError('분석 입력은 안전한 범위의 정수여야 합니다.');
    return parsed;
  }
  const startIndex = integer(draft.startIndex), count = integer(draft.count), maxLag = integer(draft.maxLag), minOverlap = integer(draft.minOverlap);
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 2 || sampleCount > MODEL_LIMITS.maxSteps + 1 || count < 2 || count > 8192 || startIndex > sampleCount - count) return draftError('선택 구간은 기록 범위 안의 2~8192개 표본이어야 합니다.');
  if (maxLag > Math.min(512, count - 1)) return draftError('최대 지연은 0~512이며 선택 표본 수보다 작아야 합니다.');
  if (minOverlap < 2 || minOverlap > count) return draftError('최소 겹침은 2 이상이며 선택 표본 수 이하여야 합니다.');
  return { startIndex, count, maxLag, minOverlap };
}
