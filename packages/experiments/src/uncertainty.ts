import { compileModel } from '../../compiler/src';
import { manifestForHash } from '../../codegen-ts/src/manifest';
import { ModelError, signalElementCount, type CalcModel, type CompiledModel, type Diagnostic } from '../../model/src';
import { sha256 } from '../../model/src/sha256';
import { runModel } from '../../runtime/src';
import type { SweepBudget, SweepOptions } from './index';
import type { MultiSweepRecord, ParameterValue } from './multivariable';
import { fail, freezeSnapshot, plainOptions, validatedResult } from './internal';

export const ENSEMBLE_LIMITS = Object.freeze({ maxParameters: 3, maxSamples: 64, maxWallMs: 30_000, maxRecordedValues: 1_000_000, maxOperations: 50_000_000, maxParameterMagnitude: 1e12, maxSnapshotBytes: 32 * 1024 * 1024 });
export type ParameterDistribution = { kind: 'uniform'; lower: number; upper: number } | { kind: 'triangular'; lower: number; mode: number; upper: number };
export interface UncertainParameter { nodeId: string; parameter: string; distribution: ParameterDistribution }
export interface EnsembleSpec { seed: number; sampleCount: number; parameters: UncertainParameter[]; outputId: string; unit: string }
export interface EnsembleProgress { completed: number; total: number; attempted: number; failed: number; cancelled: number }
export interface EnsembleOptions extends Omit<SweepOptions, 'onProgress'> { onProgress?: (progress: EnsembleProgress) => void }
export interface EnsembleRecord { id: string; parameters: ParameterValue[]; status: 'completed' | 'failed' | 'cancelled' | 'not-started'; run?: MultiSweepRecord; diagnostics: Diagnostic[] }
export interface EnsemblePoint { time: number; count: number; mean: number; standardDeviation: number | null; minimum: number; maximum: number; q05: number; median: number; q95: number }
export interface EnsembleStatistics {
  status: 'completed' | 'unavailable' | 'failed'; outputId: string; unit: string; recordIds: string[];
  standardDeviationConvention: 'sample-n-minus-one'; quantileConvention: 'linear-n-minus-one'; points: EnsemblePoint[]; diagnostics: Diagnostic[];
}
export interface EnsembleResult {
  status: 'completed' | 'failed' | 'cancelled'; baseModel: CalcModel; baseSemanticHash: string; spec: EnsembleSpec;
  prng: { algorithm: 'lcg32-1664525-1013904223'; drawOrder: 'sample-then-parameter'; uniform: '(state+0.5)/2^32' };
  records: EnsembleRecord[]; counts: { requested: number; attempted: number; completed: number; failed: number; cancelled: number; notStarted: number };
  statistics: EnsembleStatistics;
  /** Operations/recordedValues count validated returned runs only; unknown/crashed/aborted work cannot be inferred. Wall time also includes preparation and aggregation. */
  resources: { operations: number; recordedValues: number; wallMs: number }; diagnostics: Diagnostic[];
}

function array(input: unknown): asserts input is UncertainParameter[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length < 1 || input.length > ENSEMBLE_LIMITS.maxParameters) fail('INVALID_ENSEMBLE', '불확실한 계수는 1~3개 지정해 주세요.');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== input.length + 1 || Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || !('value' in descriptors[key]!) || !descriptors[key]!.enumerable))) fail('INVALID_ENSEMBLE', '계수 배열에는 빈 칸·접근자·숨김 필드를 사용할 수 없습니다.');
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= ENSEMBLE_LIMITS.maxParameterMagnitude; }
/** A hostile executor error cannot execute diagnostic or partial-result accessors. */
function diagnosticsFor(error: unknown): Diagnostic[] {
  const fallback = [{ code: 'ENSEMBLE_EXECUTION_FAILED', message: '표본 실행 중 오류가 발생했습니다.' }];
  if (!(error instanceof ModelError)) return fallback;
  const diagnostics = Object.getOwnPropertyDescriptor(error, 'diagnostics')?.value;
  if (!Array.isArray(diagnostics) || Object.getPrototypeOf(diagnostics) !== Array.prototype) return fallback;
  const output: Diagnostic[] = [];
  for (let index = 0; index < Math.min(20, diagnostics.length); index += 1) {
    const diagnostic = Object.getOwnPropertyDescriptor(diagnostics, String(index))?.value;
    if (diagnostic === null || typeof diagnostic !== 'object') continue;
    const code = Object.getOwnPropertyDescriptor(diagnostic, 'code')?.value, message = Object.getOwnPropertyDescriptor(diagnostic, 'message')?.value;
    if (typeof code === 'string' && typeof message === 'string') output.push({ code: code.slice(0, 100), message: message.slice(0, 2_000) });
  }
  return output.length ? output : fallback;
}
function legacyScalar(descriptor: CompiledModel['outputTypes'][string] | undefined): boolean { return !!descriptor && descriptor.valueType === 'float64' && descriptor.shape.length === 0 && descriptor.representation === undefined; }
function validateSpec(input: EnsembleSpec, compiled: CompiledModel): EnsembleSpec {
  plainOptions(input, ['seed', 'sampleCount', 'parameters', 'outputId', 'unit'], 'INVALID_ENSEMBLE');
  if (!Number.isSafeInteger(input.seed) || input.seed < 0 || input.seed > 0xffff_ffff || !Number.isSafeInteger(input.sampleCount) || input.sampleCount < 2 || input.sampleCount > ENSEMBLE_LIMITS.maxSamples) fail('INVALID_ENSEMBLE', 'seed는 0~4294967295 정수, 표본 수는 2~64 정수여야 합니다.');
  array(input.parameters);
  const keys: string[] = [];
  for (const parameter of input.parameters) {
    plainOptions(parameter, ['nodeId', 'parameter', 'distribution'], 'INVALID_ENSEMBLE');
    if (typeof parameter.nodeId !== 'string' || parameter.nodeId.length > 160 || typeof parameter.parameter !== 'string' || parameter.parameter.length > 160) fail('INVALID_ENSEMBLE_TARGET', '계수 블록 ID와 파라미터를 확인해 주세요.');
    const node = compiled.model.nodes.find((item) => item.id === parameter.nodeId), ir = compiled.nodes.find((item) => item.id === parameter.nodeId);
    if (!node || !ir || !(parameter.parameter === 'value' && ['source.constant', 'io.input'].includes(node.blockType) || parameter.parameter === 'gain' && node.blockType === 'math.gain') || !finite(node.parameters[parameter.parameter]) || !legacyScalar(ir.outputs.out)) fail('INVALID_ENSEMBLE_TARGET', '루트 모델의 legacy float64 scalar Constant·Input 값 또는 Gain 배율만 지원합니다.');
    keys.push(JSON.stringify([parameter.nodeId, parameter.parameter]));
    const distribution = parameter.distribution;
    plainOptions(distribution, ['kind', 'lower', 'upper', 'mode'], 'INVALID_ENSEMBLE');
    if (distribution.kind !== 'uniform' && distribution.kind !== 'triangular' || !finite(distribution.lower) || !finite(distribution.upper) || distribution.lower >= distribution.upper) fail('INVALID_ENSEMBLE', '균등·삼각 분포와 절댓값 10¹² 이하의 유한한 하한 < 상한이 필요합니다.');
    if (distribution.kind === 'uniform' && Object.hasOwn(distribution, 'mode') || distribution.kind === 'triangular' && (!finite(distribution.mode) || distribution.mode < distribution.lower || distribution.mode > distribution.upper)) fail('INVALID_ENSEMBLE', '삼각 분포의 최빈값은 범위 안에 있어야 합니다. 균등 분포에는 최빈값을 지정하지 않습니다.');
  }
  if (new Set(keys).size !== keys.length) fail('INVALID_ENSEMBLE_TARGET', '같은 블록 계수를 두 번 지정할 수 없습니다.');
  if (typeof input.outputId !== 'string' || input.outputId.length > 160 || typeof input.unit !== 'string' || input.unit.length > 160 || !legacyScalar(compiled.outputTypes[input.outputId])) fail('INVALID_ENSEMBLE_OUTPUT', 'legacy float64 scalar 출력과 단위를 지정해 주세요.');
  if (compiled.outputTypes[input.outputId]!.unit !== input.unit) fail('ENSEMBLE_UNIT_MISMATCH', '집계 단위는 선택한 출력의 단위와 정확히 같아야 합니다.');
  return freezeSnapshot(structuredClone(input));
}
function optionsSnapshot(input: EnsembleOptions): EnsembleOptions & { maxRuns: number; maxWallMs: number; maxRecordedValues: number; maxOperations: number } {
  plainOptions(input, ['signal', 'onProgress', 'execute', 'maxRuns', 'maxWallMs', 'maxRecordedValues', 'maxOperations'], 'INVALID_ENSEMBLE_OPTIONS');
  const options = { ...input, maxRuns: input.maxRuns ?? ENSEMBLE_LIMITS.maxSamples, maxWallMs: input.maxWallMs ?? ENSEMBLE_LIMITS.maxWallMs, maxRecordedValues: input.maxRecordedValues ?? ENSEMBLE_LIMITS.maxRecordedValues, maxOperations: input.maxOperations ?? ENSEMBLE_LIMITS.maxOperations };
  for (const key of ['maxRuns', 'maxRecordedValues', 'maxOperations'] as const) if (!Number.isSafeInteger(options[key]) || options[key] < 1 || options[key] > (key === 'maxRuns' ? ENSEMBLE_LIMITS.maxSamples : ENSEMBLE_LIMITS[key])) fail('INVALID_ENSEMBLE_OPTIONS', '반복·기록·연산 한도는 허용 상한 이하의 양의 정수여야 합니다.');
  if (!Number.isFinite(options.maxWallMs) || options.maxWallMs <= 0 || options.maxWallMs > ENSEMBLE_LIMITS.maxWallMs || options.signal !== undefined && !(options.signal instanceof AbortSignal) || options.execute !== undefined && typeof options.execute !== 'function' || options.onProgress !== undefined && typeof options.onProgress !== 'function') fail('INVALID_ENSEMBLE_OPTIONS', '시간 한도·취소 신호·콜백을 확인해 주세요.');
  return options;
}
function plan(spec: EnsembleSpec): EnsembleRecord[] {
  let state = spec.seed;
  return Array.from({ length: spec.sampleCount }, (_, index) => ({ id: `sample${index + 1}`, status: 'not-started', diagnostics: [], parameters: spec.parameters.map((parameter) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const u = (state + 0.5) / 4_294_967_296, distribution = parameter.distribution, span = distribution.upper - distribution.lower;
    let value: number;
    if (distribution.kind === 'uniform') value = distribution.lower + span * u;
    else {
      const split = (distribution.mode - distribution.lower) / span;
      value = u < split ? distribution.lower + Math.sqrt(u * span * (distribution.mode - distribution.lower)) : distribution.upper - Math.sqrt((1 - u) * span * (distribution.upper - distribution.mode));
    }
    return { nodeId: parameter.nodeId, parameter: parameter.parameter, value };
  }) }));
}
function statisticsBase(spec: EnsembleSpec): EnsembleStatistics {
  return { status: 'unavailable', outputId: spec.outputId, unit: spec.unit, recordIds: [], standardDeviationConvention: 'sample-n-minus-one', quantileConvention: 'linear-n-minus-one', points: [], diagnostics: [] };
}
function aggregate(records: EnsembleRecord[], spec: EnsembleSpec, check: () => void): EnsembleStatistics {
  const report = statisticsBase(spec), completed = records.filter((record) => record.status === 'completed');
  report.recordIds = completed.map((record) => record.id);
  if (!completed.length) { report.diagnostics.push({ code: 'ENSEMBLE_NO_COMPLETED_RUNS', message: '완료한 실행이 없어 통계를 계산하지 않았습니다.' }); return report; }
  try {
    const reference = completed[0]!.run!, samples = reference.result.samples;
    for (const record of completed) {
      check();
      const run = record.run!, descriptor = run.manifest.outputTypes[spec.outputId];
      if (!legacyScalar(descriptor) || descriptor!.unit !== spec.unit || run.result.samples.length !== samples.length || run.result.samples.some((sample, index) => sample.time !== samples[index]!.time || sample.time !== run.model.execution.startTime + index * run.model.execution.step)) fail('ENSEMBLE_STATISTICS_GRID', '집계에는 자료형·단위·원시 시간 격자가 정확히 같은 완료 실행만 필요합니다. 보간하지 않습니다.');
    }
    for (let index = 0; index < samples.length; index += 1) {
      check();
      const values = completed.map((record) => record.run!.result.samples[index]!.values[spec.outputId]);
      if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) fail('ENSEMBLE_STATISTICS_VALUE', '통계 출력은 유한한 legacy float64 scalar여야 합니다.');
      const sorted = (values as number[]).sort((a, b) => a - b), count = sorted.length, scale = Math.max(...sorted.map(Math.abs));
      const normalizedMean = scale === 0 ? 0 : Math.max(-1, Math.min(1, sorted.reduce((sum, value) => sum + value / scale / count, 0)));
      const mean = scale * normalizedMean, standardDeviation = count === 1 ? null : scale === 0 ? 0 : scale * Math.sqrt(sorted.reduce((sum, value) => sum + (value / scale - normalizedMean) ** 2, 0) / (count - 1));
      const quantile = (probability: number): number => {
        const position = (count - 1) * probability, lower = Math.floor(position), fraction = position - lower, a = sorted[lower]!, b = sorted[Math.min(lower + 1, count - 1)]!;
        return scale === 0 ? 0 : scale * Math.max(-1, Math.min(1, a / scale * (1 - fraction) + b / scale * fraction));
      };
      const point: EnsemblePoint = { time: samples[index]!.time, count, mean, standardDeviation, minimum: sorted[0]!, maximum: sorted[count - 1]!, q05: quantile(0.05), median: quantile(0.5), q95: quantile(0.95) };
      if (Object.values(point).some((value) => value !== null && !Number.isFinite(value))) fail('ENSEMBLE_STATISTICS_NONFINITE', '통계가 float64 범위를 초과했습니다. 실행 원본은 보존하고 집계값은 제공하지 않습니다.');
      report.points.push(point);
    }
    check(); report.status = 'completed'; return report;
  } catch (error) { report.status = 'failed'; report.points = []; report.diagnostics = diagnosticsFor(error); return report; }
}

/** Independent bounded draws; all plans and variants are captured before the first execution. */
export async function runUncertaintyEnsemble(input: CalcModel, rawSpec: EnsembleSpec, rawOptions: EnsembleOptions = {}): Promise<EnsembleResult> {
  const started = performance.now(), options = optionsSnapshot(rawOptions), compiledBase = compileModel(input), spec = validateSpec(rawSpec, compiledBase), base = compiledBase.model;
  if (spec.sampleCount > options.maxRuns) fail('INVALID_ENSEMBLE', '표본 수가 지정한 반복 한도를 초과했습니다.');
  if (compiledBase.outputIds.some((id) => { const descriptor = compiledBase.outputTypes[id]!; return !['float64', 'boolean'].includes(descriptor.valueType) || descriptor.representation !== undefined; })) fail('ENSEMBLE_UNSUPPORTED_RECORDED_OUTPUT', '현재 앙상블 실행 기록은 legacy 숫자·boolean 출력만 지원합니다. 다른 typed·bus·messages 출력 기록을 제거한 모델을 사용해 주세요.');
  const sampleTimes = base.execution.mode === 'static' ? 1 : Math.round((base.execution.stopTime - base.execution.startTime) / base.execution.step) + 1;
  const projection = spec.sampleCount * sampleTimes * (1 + compiledBase.outputIds.reduce((sum, id) => sum + signalElementCount(compiledBase.outputTypes[id]!), 0));
  if (!Number.isSafeInteger(projection) || projection > ENSEMBLE_LIMITS.maxRecordedValues) fail('ENSEMBLE_RECORD_PREFLIGHT', '전체 계획의 시각과 모든 출력 원소가 공유 기록 상한 100만 개를 초과합니다.');
  if (new TextEncoder().encode(JSON.stringify(base)).length * spec.sampleCount > ENSEMBLE_LIMITS.maxSnapshotBytes) fail('ENSEMBLE_SNAPSHOT_PREFLIGHT', '실행별 모델 스냅샷의 예상 크기가 공유 상한 32 MiB를 초과합니다.');
  const records = plan(spec), variants = records.map((record) => {
    const model = structuredClone(base);
    for (const parameter of record.parameters) model.nodes.find((node) => node.id === parameter.nodeId)!.parameters[parameter.parameter] = parameter.value;
    return compileModel(model);
  });
  const controller = new AbortController(), abort = (): void => { controller.abort(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  let usedRecords = 0, usedOperations = 0, reportedWall = 0, attempted = 0, stopped: 'failed' | 'cancelled' | undefined;
  const diagnostics: Diagnostic[] = [];
  const wallMs = (): number => Math.max(performance.now() - started, reportedWall);
  const check = (): void => {
    if (controller.signal.aborted) fail('ENSEMBLE_CANCELLED', '불확실성 앙상블을 취소했습니다.');
    if (wallMs() >= options.maxWallMs) fail('ENSEMBLE_WALL_BUDGET', '실험 전체의 공유 시간 한도를 초과했습니다.');
  };
  const execute = options.execute ?? ((model: CalcModel, budget: SweepBudget) => runModel(compileModel(model), { ...budget, signal: controller.signal }));
  try {
    for (const [index, record] of records.entries()) {
      if (controller.signal.aborted) { stopped = 'cancelled'; break; }
      try {
        check();
        const budget: SweepBudget = { maxWallMs: options.maxWallMs - wallMs(), maxRecordedValues: options.maxRecordedValues - usedRecords, maxOperations: options.maxOperations - usedOperations, trackOperations: true };
        if (budget.maxRecordedValues < 1) fail('ENSEMBLE_RECORD_BUDGET', '실험 전체의 공유 기록 한도를 모두 사용했습니다.');
        if (budget.maxOperations < 1) fail('ENSEMBLE_OPERATION_BUDGET', '실험 전체의 공유 연산 한도를 모두 사용했습니다.');
        let timer: ReturnType<typeof setTimeout> | undefined, abortListener: (() => void) | undefined;
        let executionError: unknown, result: unknown, timedOut = false;
        attempted += 1;
        try {
          result = await Promise.race([
            Promise.resolve().then(() => controller.signal.aborted ? fail('ENSEMBLE_CANCELLED', '불확실성 앙상블을 취소했습니다.') : execute(freezeSnapshot(structuredClone(variants[index]!.model)), freezeSnapshot({ ...budget }))),
            new Promise<never>((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new ModelError([{ code: 'ENSEMBLE_WALL_BUDGET', message: '실험 전체의 공유 시간 한도를 초과했습니다.' }])); controller.abort(); }, budget.maxWallMs); }),
            new Promise<never>((_, reject) => { abortListener = () => reject(new ModelError([{ code: 'ENSEMBLE_CANCELLED', message: '불확실성 앙상블을 취소했습니다.' }])); controller.signal.addEventListener('abort', abortListener, { once: true }); if (controller.signal.aborted) abortListener(); }),
          ]);
        } catch (error) { executionError = error; result = error instanceof ModelError ? Object.getOwnPropertyDescriptor(error, 'partialResult')?.value : undefined; }
        finally { if (timer !== undefined) clearTimeout(timer); if (abortListener) controller.signal.removeEventListener('abort', abortListener); }
        // An executor that ignores abort must never publish a late completed record.
        if (controller.signal.aborted) {
          record.status = timedOut ? 'failed' : 'cancelled'; record.diagnostics = [{ code: timedOut ? 'ENSEMBLE_WALL_BUDGET' : 'ENSEMBLE_CANCELLED', message: timedOut ? '실험 전체의 공유 시간 한도를 초과했습니다.' : '불확실성 앙상블을 취소했습니다.' }];
          diagnostics.push(...record.diagnostics); stopped = timedOut ? 'failed' : 'cancelled'; break;
        }
        if (result === undefined) { record.status = 'failed'; record.diagnostics = diagnosticsFor(executionError); diagnostics.push(...record.diagnostics); stopped = 'failed'; break; }
        const captured = validatedResult(result, variants[index]!, budget);
        usedRecords += captured.records; usedOperations += captured.operations; reportedWall += captured.result.elapsedMs;
        const hash = sha256(variants[index]!.semanticKey);
        record.run = { id: record.id, parameters: structuredClone(record.parameters), modelHash: hash, model: structuredClone(variants[index]!.model), manifest: manifestForHash(variants[index]!, hash), result: captured.result };
        record.status = captured.result.status === 'cancelled' ? 'cancelled' : captured.result.status === 'completed' && executionError === undefined ? 'completed' : 'failed';
        if (record.status !== 'completed') record.diagnostics = executionError === undefined ? [{ code: record.status === 'cancelled' ? 'ENSEMBLE_CANCELLED' : 'ENSEMBLE_RUN_FAILED', message: '표본 실행이 끝까지 완료되지 않았습니다.' }] : diagnosticsFor(executionError);
        if (record.status === 'cancelled') { diagnostics.push(...record.diagnostics); stopped = 'cancelled'; controller.abort(); break; }
        if (record.status === 'failed' && record.diagnostics.some((item) => /_(?:BUDGET|LIMIT|TIMEOUT)$/.test(item.code))) { diagnostics.push(...record.diagnostics); stopped = 'failed'; break; }
        check();
        options.onProgress?.(freezeSnapshot({ completed: records.filter((item) => item.status === 'completed').length, total: records.length, attempted, failed: records.filter((item) => item.status === 'failed').length, cancelled: records.filter((item) => item.status === 'cancelled').length }));
      } catch (error) {
        if (record.status === 'not-started' && attempted > index) record.status = 'failed';
        const items = diagnosticsFor(error); if (record.status !== 'not-started') record.diagnostics.push(...items); diagnostics.push(...items); stopped = controller.signal.aborted ? 'cancelled' : 'failed'; break;
      }
    }
    if (controller.signal.aborted && !stopped) stopped = 'cancelled';
    const statistics = controller.signal.aborted ? { ...statisticsBase(spec), diagnostics: [{ code: 'ENSEMBLE_CANCELLED', message: '취소된 실험의 집계를 실행하지 않았습니다.' }] } : aggregate(records, spec, check);
    if (statistics.status === 'failed') { stopped = controller.signal.aborted ? 'cancelled' : 'failed'; diagnostics.push(...statistics.diagnostics); }
    const counts = { requested: records.length, attempted, completed: records.filter((item) => item.status === 'completed').length, failed: records.filter((item) => item.status === 'failed').length, cancelled: records.filter((item) => item.status === 'cancelled').length, notStarted: records.filter((item) => item.status === 'not-started').length };
    return { status: stopped ?? (counts.completed === counts.requested ? 'completed' : 'failed'), baseModel: structuredClone(base), baseSemanticHash: sha256(compiledBase.semanticKey), spec: structuredClone(spec), prng: { algorithm: 'lcg32-1664525-1013904223', drawOrder: 'sample-then-parameter', uniform: '(state+0.5)/2^32' }, records, counts, statistics, resources: { operations: usedOperations, recordedValues: usedRecords, wallMs: wallMs() }, diagnostics: diagnostics.slice(0, 20) };
  } finally { options.signal?.removeEventListener('abort', abort); }
}
