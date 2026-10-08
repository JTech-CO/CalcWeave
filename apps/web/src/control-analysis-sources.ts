import { compileModel } from '../../../packages/compiler/src';
import { ModelError, MODEL_LIMITS, type CalcModel, type RunResult } from '../../../packages/model/src';
import { sha256 } from '../../../packages/model/src/sha256';
import { readLinearizationStateSpace, type ControlStateSpace } from '../../../packages/analysis/src/control-system';

export interface ControlAnalysisRun { model: CalcModel; result: RunResult; semanticHash: string }
export interface ControlAnalysisSource {
  id: string; label: string; kind: 'state-space-block' | 'recorded-linearization';
  modelName: string; modelId: string; nodeId: string; semanticHash: string;
  system: ControlStateSpace; outputId?: string; time?: number; requestTime?: number;
  runStatus?: RunResult['status'];
}
const sourceLimit = 64;
function fail(message: string): never { throw new ModelError([{ code: 'CONTROL_SOURCE', message }]); }
function record(value: unknown, maximum: number = MODEL_LIMITS.maxNodes): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('분석 출처는 일반 데이터 객체여야 합니다.');
  const properties = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(properties).length > maximum || Reflect.ownKeys(properties).some(key => typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key) || !('value' in properties[key]!) || !properties[key]!.enumerable)) fail('분석 출처의 크기·접근자·숨김 필드를 확인하세요.');
}
function data(value: unknown, key: string): unknown { record(value); return Object.getOwnPropertyDescriptor(value, key)?.value; }
function array(value: unknown, maximum: number): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) fail('기록 배열의 크기를 확인하세요.');
  const properties = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(properties).length !== value.length + 1 || Reflect.ownKeys(properties).some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || !('value' in properties[key]!) || !properties[key]!.enumerable))) fail('기록 배열의 빈 칸·접근자·추가 필드는 지원하지 않습니다.');
}
function message(error: unknown): string { return (error instanceof ModelError ? error.diagnostics[0]?.message : error instanceof Error ? error.message : '분석 출처를 읽지 못했습니다.')?.slice(0, 300) ?? '분석 출처를 확인하세요.'; }
function sameMatrices(left: ControlStateSpace, right: ControlStateSpace): boolean {
  return (['A', 'B', 'C', 'D'] as const).every(key => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}
function matrices(A: unknown, B: unknown, C: unknown, D: unknown): ControlStateSpace {
  return readLinearizationStateSpace({ kind: 'bus', fields: [{ name: 'A', value: A }, { name: 'B', value: B }, { name: 'C', value: C }, { name: 'D', value: D }] });
}

/** Only root block configurations and confirmed, directly recorded M12 requests are sources.
 * A raw all-zero placeholder before the first request is never treated as a linearization.
 * Reading this view does not run a solver, modify the model or manufacture a new matrix.
 */
export function controlAnalysisSources(model: CalcModel, run?: ControlAnalysisRun | null): { sources: ControlAnalysisSource[]; issues: string[] } {
  const sources: ControlAnalysisSource[] = [], issues: string[] = [];
  const issue = (text: string) => { if (issues.length < 8) issues.push(text); };
  const append = (source: ControlAnalysisSource) => { if (sources.length < sourceLimit) sources.push(source); else if (!issues.includes('분석 출처는 최대64개까지 표시합니다.')) issue('분석 출처는 최대64개까지 표시합니다.'); };
  try {
    const compiled = compileModel(model), current = compiled.model;
    if (current.execution.mode === 'continuous') {
      const hash = sha256(compiled.semanticKey);
      for (const node of current.nodes.filter(node => node.blockType === 'continuous.state-space')) {
        try {
          const { A, B, C, D } = node.parameters;
          array(B, 4); array(C, 4);
          const system = matrices(A, B.map(value => [value]), [C], [[D]]);
          append({ id: `block-${node.id}`, label: `${node.label} · 상태 공간 설정`, kind: 'state-space-block', modelName: current.name, modelId: current.modelId, nodeId: node.id, semanticHash: hash, system });
        } catch (error) { issue(`${node.label}: ${message(error)}`); }
      }
    }
  } catch (error) { issue(`현재 도식: ${message(error)}`); }
  if (run) try {
    record(run, 3);
    const compiled = compileModel(data(run, 'model') as CalcModel), recorded = compiled.model;
    const expectedHash = sha256(compiled.semanticKey), actualHash = data(run, 'semanticHash');
    if (actualHash !== expectedHash) fail('실행 모델과 기록의 계산 지문이 다릅니다.');
    if (recorded.execution.mode !== 'continuous' || !recorded.nodes.some(node => node.blockType === 'analysis.linearization')) return { sources, issues };
    const result = data(run, 'result'); record(result, 24);
    const status = data(result, 'status');
    if (typeof status !== 'string' || !['completed', 'cancelled', 'failed'].includes(status)) fail('기록의 실행 상태를 확인하세요.');
    const samples = data(result, 'samples'); array(samples, MODEL_LIMITS.maxSteps + 1);
    if (data(result, 'steps') !== samples.length) fail('기록의 표본 수가 다릅니다.');
    if (!samples.length) return { sources, issues };
    const last = samples[samples.length - 1], time = data(last, 'time'), values = data(last, 'values'); record(values);
    if (typeof time !== 'number' || !Number.isFinite(time)) fail('기록 시각을 확인하세요.');
    const expectedTime = recorded.execution.startTime + (samples.length - 1) * recorded.execution.step;
    const tolerance = Math.min(recorded.execution.step / 8, Math.max(1e-12, 8 * Number.EPSILON * Math.max(1, Math.abs(time), Math.abs(expectedTime))));
    if (Math.abs(time - expectedTime) > tolerance) fail('마지막 표본이 실행 모델의 관측 격자와 다릅니다.');
    if (time < recorded.execution.startTime - tolerance || time > recorded.execution.stopTime + tolerance) fail('마지막 표본이 실행 모델의 시간 범위를 벗어납니다.');
    const memory = data(result, 'stateMemory');
    if (!memory) { issue('선형화 완료를 확인할 실행 상태 기록이 없습니다. 다시 실행하세요.'); return { sources, issues }; }
    record(memory);
    for (const node of recorded.nodes.filter(node => node.blockType === 'analysis.linearization')) {
      try {
        const request = data(memory, node.id);
        if (!request) continue;
        const hit = data(request, 'analysisHit'), output = data(request, 'analysisOutput');
        if (hit === undefined || output === undefined) continue;
        if (typeof hit !== 'number' || !Number.isFinite(hit) || hit < recorded.execution.startTime || hit > recorded.execution.stopTime || hit > time + tolerance) continue;
        const confirmed = readLinearizationStateSpace(output);
        const outputs = compiled.outputIds.filter(id => recorded.edges.some(edge => edge.source.nodeId === node.id && edge.source.portId === 'out' && edge.target.nodeId === id && edge.target.portId === 'in'));
        for (const outputId of outputs) {
          const raw = data(values, outputId);
          if (!raw) continue;
          const system = readLinearizationStateSpace(raw);
          if (!sameMatrices(system, confirmed)) fail('기록한 행렬과 마지막으로 완료한 선형화 행렬이 다릅니다.');
          const label = recorded.nodes.find(member => member.id === outputId)?.label ?? outputId;
          append({ id: `recorded-${node.id}-${outputId}`, label: `${label} · 기록 ${time} s`, kind: 'recorded-linearization', modelName: recorded.name, modelId: recorded.modelId, nodeId: node.id, outputId, time, requestTime: hit, runStatus: status as RunResult['status'], semanticHash: expectedHash, system });
        }
      } catch (error) { issue(`${node.label}: ${message(error)}`); }
    }
  } catch (error) { issue(`실행 기록: ${message(error)}`); }
  return { sources, issues };
}
