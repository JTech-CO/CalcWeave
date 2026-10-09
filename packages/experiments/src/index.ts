import { compileModel } from '../../compiler/src';
import { manifestForHash, type ExportManifest } from '../../codegen-ts/src/manifest';
import {
  ModelError, type CalcModel, type Diagnostic, type RunResult,
} from '../../model/src';
import { sha256 } from '../../model/src/sha256';
import { runModel } from '../../runtime/src';
import { fail, plainOptions, diagnosticsFor, freezeSnapshot, validatedResult } from './internal';
export * from './multivariable';
export * from './uncertainty';

export const SWEEP_LIMITS = Object.freeze({ maxRuns: 16, maxWallMs: 30_000, maxRecordedValues: 1_000_000, maxOperations: 50_000_000 });
export interface SweepSpec { nodeId: string; parameter: string; values: number[] }
export interface SweepBudget { maxWallMs: number; maxRecordedValues: number; maxOperations: number; trackOperations: true }
export interface SweepRecord { id: string; value: number; modelHash: string; model: CalcModel; manifest: ExportManifest; result: RunResult }
export interface SweepProgress { completed: number; total: number; records: SweepRecord[] }
export interface SweepOptions {
  signal?: AbortSignal;
  onProgress?: (progress: SweepProgress) => void;
  execute?: (model: CalcModel, budget: SweepBudget) => Promise<RunResult>;
  maxRuns?: number;
  maxWallMs?: number;
  maxRecordedValues?: number;
  maxOperations?: number;
}
export interface SweepResult { status: 'completed' | 'cancelled' | 'failed'; records: SweepRecord[]; diagnostics?: Diagnostic[] }

/** Validate every variant first, then run one at a time against one shared resource budget. */
export async function runParameterSweep(input: CalcModel, spec: SweepSpec, options: SweepOptions = {}): Promise<SweepResult> {
  const started = performance.now();
  plainOptions(spec, ['nodeId', 'parameter', 'values'], 'INVALID_SWEEP');
  plainOptions(options, ['signal', 'onProgress', 'execute', 'maxRuns', 'maxWallMs', 'maxRecordedValues', 'maxOperations'], 'INVALID_SWEEP_OPTIONS');
  const limits = { maxRuns: options.maxRuns ?? SWEEP_LIMITS.maxRuns, maxWallMs: options.maxWallMs ?? SWEEP_LIMITS.maxWallMs, maxRecordedValues: options.maxRecordedValues ?? SWEEP_LIMITS.maxRecordedValues, maxOperations: options.maxOperations ?? SWEEP_LIMITS.maxOperations };
  for (const key of ['maxRuns', 'maxRecordedValues', 'maxOperations'] as const) if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > SWEEP_LIMITS[key]) fail('INVALID_SWEEP_OPTIONS', '반복 횟수·기록·연산 한도는 허용 범위의 양의 정수여야 합니다.');
  if (!Number.isFinite(limits.maxWallMs) || limits.maxWallMs <= 0 || limits.maxWallMs > SWEEP_LIMITS.maxWallMs
    || (options.execute !== undefined && typeof options.execute !== 'function')
    || (options.onProgress !== undefined && typeof options.onProgress !== 'function')
    || (options.signal !== undefined && !(options.signal instanceof AbortSignal))) fail('INVALID_SWEEP_OPTIONS', '실행 시간 한도·취소 신호·콜백을 확인해 주세요.');
  if (typeof spec.nodeId !== 'string' || typeof spec.parameter !== 'string' || !Array.isArray(spec.values) || spec.values.length < 1 || spec.values.length > limits.maxRuns) fail('INVALID_SWEEP', '한 scalar 파라미터와 1~16개 반복 값을 지정해 주세요.');
  const valueDescriptors = Object.getOwnPropertyDescriptors(spec.values);
  if (Object.getPrototypeOf(spec.values) !== Array.prototype || Object.keys(valueDescriptors).length !== spec.values.length + 1
    || Reflect.ownKeys(valueDescriptors).some((key) => typeof key !== 'string' || (key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || !('value' in valueDescriptors[key]!))))) fail('INVALID_SWEEP', '반복 값은 일반 숫자 배열이어야 합니다.');
  if (spec.values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) fail('INVALID_SWEEP', '반복 값은 유한한 숫자여야 합니다.');
  const base = compileModel(input).model;
  const target = base.nodes.find((node) => node.id === spec.nodeId);
  const allowed = target && ((['source.constant', 'io.input'].includes(target.blockType) && spec.parameter === 'value') || (target.blockType === 'math.gain' && spec.parameter === 'gain'));
  if (!allowed || typeof target!.parameters[spec.parameter] !== 'number' || !Number.isFinite(target!.parameters[spec.parameter])) fail('INVALID_SWEEP_TARGET', '루트 모델의 scalar Constant·Input 값 또는 Gain 배율만 반복할 수 있습니다.');
  if (options.signal?.aborted) return { status: 'cancelled', records: [] };
  const variants = spec.values.map((value) => {
    const model = structuredClone(base); model.nodes.find((node) => node.id === spec.nodeId)!.parameters[spec.parameter] = value;
    const compiled = compileModel(model), hash = sha256(compiled.semanticKey);
    return { value, compiled, modelHash: hash, manifest: manifestForHash(compiled, hash) };
  });
  const records: SweepRecord[] = [];
  let usedRecords = 0, usedOperations = 0, reportedWall = 0;
  const controller = new AbortController();
  const abort = (): void => { controller.abort(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  const execute = options.execute ?? ((model: CalcModel, budget: SweepBudget) => runModel(compileModel(model), { ...budget, signal: controller.signal }));
  const report = (): void => { options.onProgress?.({ completed: records.filter((record) => record.result.status === 'completed').length, total: variants.length, records: structuredClone(records) }); };
  try {
    for (const [index, variant] of variants.entries()) {
      if (options.signal?.aborted) return { status: 'cancelled', records };
      const budget: SweepBudget = { maxWallMs: limits.maxWallMs - Math.max(performance.now() - started, reportedWall), maxRecordedValues: limits.maxRecordedValues - usedRecords, maxOperations: limits.maxOperations - usedOperations, trackOperations: true };
      if (budget.maxWallMs <= 0) return { status: 'failed', records, diagnostics: [{ code: 'SWEEP_WALL_BUDGET', message: '반복 실행 전체의 공유 시간 한도를 초과했습니다.' }] };
      if (budget.maxRecordedValues < 1) return { status: 'failed', records, diagnostics: [{ code: 'SWEEP_RECORD_BUDGET', message: '반복 실행 전체의 공유 기록 한도를 모두 사용했습니다.' }] };
      if (budget.maxOperations < 1) return { status: 'failed', records, diagnostics: [{ code: 'SWEEP_OPERATION_BUDGET', message: '반복 실행 전체의 공유 연산 한도를 모두 사용했습니다.' }] };
      let timer: ReturnType<typeof setTimeout> | undefined;
      let executionError: unknown;
      let result: RunResult | undefined;
      try {
        result = await Promise.race([
          execute(freezeSnapshot(structuredClone(variant.compiled.model)), freezeSnapshot({ ...budget })),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ModelError([{ code: 'SWEEP_WALL_BUDGET', message: '반복 실행 전체의 공유 시간 한도를 초과했습니다.' }])); }, budget.maxWallMs); }),
        ]);
      } catch (error) { executionError = error; result = error instanceof ModelError ? error.partialResult : undefined; }
      finally { if (timer !== undefined) clearTimeout(timer); }
      if (result !== undefined) {
        let captured;
        try { captured = validatedResult(result, variant.compiled, budget); }
        catch (error) { return { status: 'failed', records, diagnostics: diagnosticsFor(error) }; }
        usedRecords += captured.records; usedOperations += captured.operations; reportedWall += captured.result.elapsedMs;
        records.push({ id: `run${index + 1}`, value: variant.value, modelHash: variant.modelHash, model: structuredClone(variant.compiled.model), manifest: structuredClone(variant.manifest), result: captured.result });
        report();
        if (captured.result.status === 'cancelled' || options.signal?.aborted) return { status: 'cancelled', records };
        if (captured.result.status === 'failed' || executionError !== undefined) return { status: 'failed', records, diagnostics: executionError === undefined ? [{ code: 'SWEEP_RUN_FAILED', message: '반복 실행이 실패하여 이후 실행을 중단했습니다.' }] : diagnosticsFor(executionError) };
      } else if (options.signal?.aborted) return { status: 'cancelled', records };
      else return { status: 'failed', records, diagnostics: diagnosticsFor(executionError) };
      if (Math.max(performance.now() - started, reportedWall) > limits.maxWallMs) return { status: 'failed', records, diagnostics: [{ code: 'SWEEP_WALL_BUDGET', message: '반복 실행 전체의 공유 시간 한도를 초과했습니다.' }] };
    }
    return { status: 'completed', records };
  } finally { options.signal?.removeEventListener('abort', abort); }
}

export interface RunComparisonValue { recordId: string; status: RunResult['status']; finalValue: number; delta: number; rmse: number }
export interface RunComparison { status: 'completed' | 'failed'; referenceId?: string; outputs: { nodeId: string; unit: string; values: RunComparisonValue[] }[]; diagnostics?: Diagnostic[] }

/** Compare scalar raw outputs on an identical time grid; no hidden interpolation is performed. */
export function compareRuns(records: readonly SweepRecord[]): RunComparison {
  const invalid = (code: string, message: string): RunComparison => ({ status: 'failed', outputs: [], diagnostics: [{ code, message }] });
  if (!Array.isArray(records) || records.length < 1 || records.length > 3) return invalid('SWEEP_COMPARE_COUNT', '비교할 실행을 1~3개 선택해 주세요.');
  const runs: readonly SweepRecord[] = records;
  const reference = runs[0]!;
  if (!reference.result?.samples.length) return invalid('SWEEP_COMPARE_EMPTY', '비교하려면 기록된 표본이 필요합니다.');
  if (runs.some((record) => !record.result || record.result.samples.length !== reference.result.samples.length || record.result.samples.some((sample, index) => sample.time !== reference.result.samples[index]!.time))) return invalid('SWEEP_COMPARE_GRID', '실행의 시간축이 다릅니다. 같은 시간 간격과 구간으로 다시 실행해 주세요.');
  const ids = Object.keys(reference.manifest.outputTypes).filter((id) => runs.every((record) => record.manifest.outputTypes[id]?.valueType === 'float64' && record.manifest.outputTypes[id]!.shape.length === 0));
  if (!ids.length) return invalid('SWEEP_COMPARE_OUTPUT', '모든 실행에 공통인 scalar 숫자 출력이 없습니다.');
  const outputs: RunComparison['outputs'] = [];
  for (const nodeId of ids.sort()) {
    const unit = reference.manifest.outputTypes[nodeId]!.unit;
    if (runs.some((record) => record.manifest.outputTypes[nodeId]!.unit !== unit)) return invalid('SWEEP_COMPARE_UNIT', '공통 출력의 단위가 다릅니다. 단위를 맞춘 실행을 선택해 주세요.');
    const baseline = reference.result.samples.map((sample) => sample.values[nodeId]);
    const values: RunComparisonValue[] = [];
    for (const record of runs) {
      const samples = record.result.samples.map((sample) => sample.values[nodeId]);
      if (samples.some((value) => typeof value !== 'number' || !Number.isFinite(value)) || baseline.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return invalid('SWEEP_COMPARE_VALUE', '비교 출력은 유한한 scalar 숫자여야 합니다.');
      const differences = samples.map((value, index) => (value as number) - (baseline[index] as number));
      if (differences.some((value) => !Number.isFinite(value))) return invalid('SWEEP_COMPARE_NONFINITE', '실행 간 차이가 float64 범위를 초과했습니다.');
      const scale = Math.max(...differences.map(Math.abs));
      const rmse = scale === 0 ? 0 : scale * Math.sqrt(differences.reduce((sum, value) => sum + (value / scale) ** 2, 0) / differences.length);
      values.push({ recordId: record.id, status: record.result.status, finalValue: samples.at(-1) as number, delta: differences.at(-1)!, rmse });
    }
    outputs.push({ nodeId, unit, values });
  }
  return { status: 'completed', referenceId: reference.id, outputs };
}
