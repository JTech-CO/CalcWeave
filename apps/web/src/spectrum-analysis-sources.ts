import { compileModel } from '../../../packages/compiler/src';
import { ModelError, MODEL_LIMITS, type RunSample, type SignalDescriptor } from '../../../packages/model/src';
import { sha256 } from '../../../packages/model/src/sha256';
import { prepareScopeObservation } from '../../../packages/analysis/src/scope-observation';
import type { SpectrumInput } from '../../../packages/analysis/src/spectrum';
import type { ControlAnalysisRun } from './control-analysis-sources';

export const SPECTRUM_SOURCE_LIMITS = Object.freeze({ sources: 16, recordedElements: 1_000_000 });
export interface SpectrumAnalysisSource {
  id: string; label: string; modelName: string; modelId: string; semanticHash: string;
  runStatus: 'completed'; outputId: string; unit: string; valueType: 'float64' | 'typed';
  shape: number[]; components: { index: number; label: string }[]; sampleCount: number;
}
export interface SpectrumSourceSnapshot extends SpectrumAnalysisSource {
  componentIndex: number; componentLabel: string; startIndex: number; count: number;
  startTime: number; endTime: number; samplesSha256: string;
}
function fail(message: string): never { throw new ModelError([{ code: 'SPECTRUM_SOURCE', message }]); }
function object(input: unknown, maximum: number = MODEL_LIMITS.maxNodes): asserts input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail('스펙트럼 출처는 일반 데이터 객체여야 합니다.');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > maximum || keys.some(key => typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !('value' in descriptors[key]!) || !descriptors[key]!.enumerable)) fail('스펙트럼 출처의 크기·접근자·숨김 속성을 확인하세요.');
}
function own(input: unknown, key: string): unknown { object(input); return Object.getOwnPropertyDescriptor(input, key)?.value; }
function array(input: unknown, maximum: number): asserts input is unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > maximum) fail('스펙트럼 기록 배열의 크기를 확인하세요.');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== input.length + 1 || Reflect.ownKeys(descriptors).some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || !('value' in descriptors[key]!) || !descriptors[key]!.enumerable))) fail('스펙트럼 기록에는 접근자·빈 칸·추가 속성을 허용하지 않습니다.');
}
function message(error: unknown): string {
  return (error instanceof ModelError ? error.diagnostics[0]?.message : error instanceof Error ? error.message : '스펙트럼 기록을 확인하세요.')?.slice(0, 300) ?? '스펙트럼 기록을 확인하세요.';
}
function recorded(run: ControlAnalysisRun) {
  object(run, 3);
  const compiled = compileModel(own(run, 'model') as ControlAnalysisRun['model']);
  if (own(run, 'semanticHash') !== sha256(compiled.semanticKey)) fail('실행 모델과 스펙트럼 기록의 계산 지문이 다릅니다.');
  const execution = compiled.model.execution;
  if (execution.mode === 'static') fail('스펙트럼 분석에는 완료된 시간 시뮬레이션이 필요합니다.');
  const result = own(run, 'result'); object(result, 24);
  if (own(result, 'status') !== 'completed') fail('스펙트럼 분석에는 완료된 실행 기록이 필요합니다. 부분·실패 기록은 분석하지 않습니다.');
  const samples = own(result, 'samples'); array(samples, MODEL_LIMITS.maxSteps + 1);
  if (samples.length < 8 || own(result, 'steps') !== samples.length) fail('시간 기록은 표본 수가 일치하는 8개 이상의 표본이어야 합니다.');
  const intervals = Math.round((execution.stopTime - execution.startTime) / execution.step);
  if (samples.length !== intervals + 1) fail('완료 기록의 표본 수가 실행 모델의 시간 격자와 다릅니다.');
  for (let index = 0; index < samples.length; index++) {
    const time = own(samples[index], 'time');
    const expected = execution.startTime + index * execution.step;
    const tolerance = Math.min(execution.step / 8, Math.max(1e-12, 8 * Number.EPSILON * Math.max(1, Math.abs(expected))));
    if (typeof time !== 'number' || !Number.isFinite(time) || Math.abs(time - expected) > tolerance) fail('스펙트럼 기록의 시각이 실행 당시의 균일 관측 격자와 다릅니다.');
  }
  return { compiled, samples: samples as RunSample[] };
}
function supported(descriptor: SignalDescriptor): boolean {
  return descriptor.valueType === 'float64' || descriptor.valueType === 'typed' && ['float32', 'float64'].includes(descriptor.typed?.dtype ?? '') && descriptor.shape.length <= 1;
}

/** Offers bounded completed observations, using the recorded model rather than the current draft. */
export function spectrumAnalysisSources(run?: ControlAnalysisRun | null): { sources: SpectrumAnalysisSource[]; issues: string[] } {
  const sources: SpectrumAnalysisSource[] = [], issues: string[] = [];
  if (!run) return { sources, issues: ['시간 시뮬레이션을 완료한 뒤 기록의 주파수를 분석하세요.'] };
  const issue = (text: string) => { if (issues.length < 8 && !issues.includes(text)) issues.push(text); };
  try {
    const { compiled, samples } = recorded(run);
    let elements = 0;
    for (const outputId of compiled.outputIds) {
      const descriptor = compiled.outputTypes[outputId]!;
      if (!supported(descriptor)) { issue('정수·고정소수점·복소수·boolean·문자열·버스·메시지는 FFT의 실수 입력으로 자동 변환하지 않습니다.'); continue; }
      if (sources.length === SPECTRUM_SOURCE_LIMITS.sources) { issue('스펙트럼 출력은 최대16개까지 표시합니다.'); break; }
      const cost = samples.length * (1 + descriptor.shape.reduce((product, size) => product * size, 1));
      if (elements + cost > SPECTRUM_SOURCE_LIMITS.recordedElements) { issue('출력 투영의 전체 기록 원소는1,000,000개 이하입니다. 큰 출력을 별도 모델로 기록하세요.'); continue; }
      elements += cost;
      const observation = prepareScopeObservation([{ id: 'spectrum-run', label: compiled.model.name, samples, descriptor, status: 'completed' }], outputId);
      if (observation.status !== 'ready') { issue(observation.diagnostics.join(' · ') || '출력의 원시 기록을 확인하세요.'); continue; }
      sources.push({ id: outputId, label: compiled.model.nodes.find(node => node.id === outputId)?.label ?? outputId,
        modelName: compiled.model.name, modelId: compiled.model.modelId, semanticHash: sha256(compiled.semanticKey),
        runStatus: 'completed', outputId, unit: descriptor.unit, valueType: descriptor.valueType as 'float64' | 'typed',
        shape: [...descriptor.shape], components: observation.components.map(component => ({ ...component })), sampleCount: samples.length });
    }
  } catch (error) { issue(message(error)); }
  return { sources, issues };
}

/** Copies an explicitly selected contiguous segment; never interpolates, pads or edits a recording. */
export function readSpectrumSelection(run: ControlAnalysisRun, outputId: string, componentIndex: number, startIndex: number, count: number): { source: SpectrumSourceSnapshot; input: SpectrumInput } {
  if (typeof outputId !== 'string' || outputId.length > 160 || !Number.isSafeInteger(componentIndex) || componentIndex < 0 || !Number.isSafeInteger(startIndex) || startIndex < 0 || !Number.isSafeInteger(count) || count < 8 || count > 8192 || (count & (count - 1)) !== 0) fail('출력·성분·시작 표본과8~8192의2의 거듭제곱 표본 수를 확인하세요.');
  const available = spectrumAnalysisSources(run), source = available.sources.find(item => item.outputId === outputId);
  if (!source) fail(available.issues.join(' · ') || '분석 가능한 완료 출력 기록이 없습니다.');
  const component = source.components.find(item => item.index === componentIndex);
  if (!component || startIndex + count > source.sampleCount) fail('선택한 성분이나 표본 구간이 기록 범위를 벗어났습니다.');
  const { compiled, samples } = recorded(run);
  const projected = prepareScopeObservation([{ id: 'spectrum-run', label: source.modelName, samples, descriptor: compiled.outputTypes[outputId], status: 'completed' }], outputId, componentIndex);
  if (projected.status !== 'ready') fail(projected.diagnostics.join(' · '));
  const points = projected.curves[0]!.points.slice(startIndex, startIndex + count);
  if (points.some(point => point.value === null)) fail('선택한 표본 구간에 비유한 값이 있습니다. 값을 지우거나 보간해 FFT를 만들지 않습니다.');
  const input = { times: points.map(point => point.time), values: points.map(point => point.value!) };
  return { source: { ...source, shape: [...source.shape], components: source.components.map(item => ({ ...item })),
    componentIndex, componentLabel: component.label, startIndex, count, startTime: input.times[0]!, endTime: input.times[count - 1]!, samplesSha256: sha256(JSON.stringify(input)) }, input };
}
