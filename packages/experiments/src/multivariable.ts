import { compileModel } from '../../compiler/src';
import { manifestForHash, type ExportManifest } from '../../codegen-ts/src/manifest';
import { ModelError, type CalcModel, type CompiledModel, type Diagnostic, type RunResult } from '../../model/src';
import { sha256 } from '../../model/src/sha256';
import { runModel } from '../../runtime/src';
import type { SweepBudget, SweepOptions } from './index';
import { diagnosticsFor, fail, freezeSnapshot, plainOptions, validatedResult } from './internal';

export const EXPERIMENT_LIMITS = Object.freeze({ maxParameters: 3, maxGridRuns: 64, maxFitEvaluations: 96, maxMeasurements: 1_000, maxParameterMagnitude: 1e12, maxWallMs: 30_000, maxRecordedValues: 1_000_000, maxOperations: 50_000_000 });
export interface ParameterAxis { nodeId: string; parameter: string; values: number[] }
export interface ParameterValue { nodeId: string; parameter: string; value: number }
export interface MultiSweepSpec { axes: ParameterAxis[] }
export interface MultiSweepRecord { id: string; parameters: ParameterValue[]; modelHash: string; model: CalcModel; manifest: ExportManifest; result: RunResult }
export interface MultiSweepResult { status: 'completed' | 'cancelled' | 'failed'; records: MultiSweepRecord[]; diagnostics?: Diagnostic[] }
export interface FitParameter { nodeId: string; parameter: string; lower: number; upper: number; initial: number }
export interface FitSpec { parameters: FitParameter[]; outputId: string; measurements: { time: number; value: number }[]; unit: string; maxEvaluations?: number }
export interface FitCandidate extends MultiSweepRecord { rmse: number; sse: number; maxAbsoluteError: number; residuals: { time: number; measured: number; predicted: number; residual: number }[] }
export interface FitResult { status: 'completed' | 'cancelled' | 'failed'; termination: 'converged' | 'evaluation-limit' | 'no-improvement' | 'cancelled' | 'failed'; evaluations: number; best?: FitCandidate; trace: { evaluation: number; parameters: ParameterValue[]; rmse: number }[]; diagnostics?: Diagnostic[] }

function array(input: unknown, maximum: number, code: string): asserts input is unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length < 1 || input.length > maximum) fail(code, `1~${maximum}개 항목의 일반 배열을 사용해 주세요.`);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== input.length + 1 || Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || (key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || !('value' in descriptors[key]!) || !descriptors[key]!.enumerable)))) fail(code, '배열의 빈 칸·접근자·숨김 필드는 지원하지 않습니다.');
}
function finiteParameter(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= EXPERIMENT_LIMITS.maxParameterMagnitude; }
function target(base: CalcModel, nodeId: unknown, parameter: unknown): void {
  if (typeof nodeId !== 'string' || nodeId.length > 160 || typeof parameter !== 'string' || parameter.length > 160) fail('INVALID_EXPERIMENT_TARGET', '계수의 블록 ID와 파라미터를 확인해 주세요.');
  const node = base.nodes.find((item) => item.id === nodeId);
  if (!node || !(parameter === 'value' && ['source.constant', 'io.input'].includes(node.blockType) || parameter === 'gain' && node.blockType === 'math.gain') || !finiteParameter(node.parameters[parameter])) fail('INVALID_EXPERIMENT_TARGET', '루트 모델의 scalar Constant·Input 값 또는 Gain 배율만 지원합니다.');
}
function uniqueTargets(parameters: { nodeId: string; parameter: string }[]): void {
  const keys = parameters.map((item) => JSON.stringify([item.nodeId, item.parameter]));
  if (new Set(keys).size !== keys.length) fail('INVALID_EXPERIMENT_TARGET', '같은 블록 계수를 두 번 지정할 수 없습니다.');
}
function compileVariant(base: CalcModel, parameters: ParameterValue[]): CompiledModel {
  const model = structuredClone(base);
  for (const item of parameters) model.nodes.find((node) => node.id === item.nodeId)!.parameters[item.parameter] = item.value;
  return compileModel(model);
}
class CandidateExecutionError extends ModelError {
  constructor(diagnostics: Diagnostic[], readonly record: MultiSweepRecord) { super(diagnostics, record.result); }
}

/** One shared deadline, operation counter and raw recording budget for all candidates. */
class ExecutionSession {
  readonly controller = new AbortController();
  executions = 0;
  private usedRecords = 0;
  private usedOperations = 0;
  private reportedWall = 0;
  private abort = (): void => { this.controller.abort(); };
  readonly limits: { maxRuns: number; maxWallMs: number; maxRecordedValues: number; maxOperations: number };
  constructor(readonly options: SweepOptions, readonly maximum: number, readonly started: number) {
    plainOptions(options, ['signal', 'onProgress', 'execute', 'maxRuns', 'maxWallMs', 'maxRecordedValues', 'maxOperations'], 'INVALID_EXPERIMENT_OPTIONS');
    this.options = options = { ...options };
    this.limits = { maxRuns: options.maxRuns ?? maximum, maxWallMs: options.maxWallMs ?? EXPERIMENT_LIMITS.maxWallMs, maxRecordedValues: options.maxRecordedValues ?? EXPERIMENT_LIMITS.maxRecordedValues, maxOperations: options.maxOperations ?? EXPERIMENT_LIMITS.maxOperations };
    for (const key of ['maxRuns', 'maxRecordedValues', 'maxOperations'] as const) if (!Number.isSafeInteger(this.limits[key]) || this.limits[key] < 1 || this.limits[key] > (key === 'maxRuns' ? maximum : EXPERIMENT_LIMITS[key])) fail('INVALID_EXPERIMENT_OPTIONS', '반복·기록·연산 한도는 허용 상한 이하의 양의 정수여야 합니다.');
    if (!Number.isFinite(this.limits.maxWallMs) || this.limits.maxWallMs <= 0 || this.limits.maxWallMs > EXPERIMENT_LIMITS.maxWallMs || options.signal !== undefined && !(options.signal instanceof AbortSignal) || options.execute !== undefined && typeof options.execute !== 'function' || options.onProgress !== undefined && typeof options.onProgress !== 'function') fail('INVALID_EXPERIMENT_OPTIONS', '시간 한도·취소 신호·콜백을 확인해 주세요.');
    options.signal?.addEventListener('abort', this.abort, { once: true });
    if (options.signal?.aborted) this.controller.abort();
  }
  close(): void { this.options.signal?.removeEventListener('abort', this.abort); }
  progress(completed: number, total: number): void { this.options.onProgress?.({ completed, total, records: [] }); }
  async run(compiled: CompiledModel, parameters: ParameterValue[], id: string): Promise<MultiSweepRecord> {
    if (this.controller.signal.aborted) throw new ModelError([{ code: 'EXPERIMENT_CANCELLED', message: '실험을 취소했습니다.' }]);
    const budget: SweepBudget = { maxWallMs: this.limits.maxWallMs - Math.max(performance.now() - this.started, this.reportedWall), maxRecordedValues: this.limits.maxRecordedValues - this.usedRecords, maxOperations: this.limits.maxOperations - this.usedOperations, trackOperations: true };
    if (budget.maxWallMs <= 0) fail('SWEEP_WALL_BUDGET', '실험 전체의 공유 시간 한도를 초과했습니다.');
    if (budget.maxRecordedValues < 1) fail('SWEEP_RECORD_BUDGET', '실험 전체의 공유 기록 한도를 모두 사용했습니다.');
    if (budget.maxOperations < 1) fail('SWEEP_OPERATION_BUDGET', '실험 전체의 공유 연산 한도를 모두 사용했습니다.');
    const execute = this.options.execute ?? ((model: CalcModel, bounds: SweepBudget) => runModel(compileModel(model), { ...bounds, signal: this.controller.signal }));
    const hash = sha256(compiled.semanticKey);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (() => void) | undefined;
    let result: RunResult | undefined, executionError: unknown;
    try {
      this.executions += 1;
      result = await Promise.race([
        execute(freezeSnapshot(structuredClone(compiled.model)), freezeSnapshot({ ...budget })),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new ModelError([{ code: 'SWEEP_WALL_BUDGET', message: '실험 전체의 공유 시간 한도를 초과했습니다.' }])); this.controller.abort(); }, budget.maxWallMs); }),
        new Promise<never>((_, reject) => { rejectAbort = () => reject(new ModelError([{ code: 'EXPERIMENT_CANCELLED', message: '실험을 취소했습니다.' }])); this.controller.signal.addEventListener('abort', rejectAbort, { once: true }); if (this.controller.signal.aborted) rejectAbort(); }),
      ]);
    } catch (error) { executionError = error; result = error instanceof ModelError ? error.partialResult : undefined; }
    finally { if (timer !== undefined) clearTimeout(timer); if (rejectAbort) this.controller.signal.removeEventListener('abort', rejectAbort); }
    if (!result) throw executionError;
    const captured = validatedResult(result, compiled, budget);
    this.usedRecords += captured.records; this.usedOperations += captured.operations; this.reportedWall += captured.result.elapsedMs;
    const record: MultiSweepRecord = { id, parameters: structuredClone(parameters), modelHash: hash, model: structuredClone(compiled.model), manifest: manifestForHash(compiled, hash), result: captured.result };
    if (captured.result.status !== 'completed' || executionError !== undefined || this.options.signal?.aborted) throw new CandidateExecutionError(executionError === undefined ? [{ code: captured.result.status === 'cancelled' || this.options.signal?.aborted ? 'EXPERIMENT_CANCELLED' : 'SWEEP_RUN_FAILED', message: '실험 실행이 끝까지 완료되지 않았습니다.' }] : diagnosticsFor(executionError), record);
    if (Math.max(performance.now() - this.started, this.reportedWall) > this.limits.maxWallMs) throw new CandidateExecutionError([{ code: 'SWEEP_WALL_BUDGET', message: '실험 전체의 공유 시간 한도를 초과했습니다.' }], record);
    return record;
  }
}
function cancelled(error: unknown, options: SweepOptions): boolean { return options.signal?.aborted === true || error instanceof ModelError && (error.partialResult?.status === 'cancelled' || error.diagnostics.some((item) => item.code === 'EXPERIMENT_CANCELLED')); }

/** Cartesian enumeration in axis/value order; every variant is validated before execution. */
export async function runMultiParameterSweep(input: CalcModel, spec: MultiSweepSpec, options: SweepOptions = {}): Promise<MultiSweepResult> {
  const started = performance.now();
  plainOptions(spec, ['axes'], 'INVALID_MULTI_SWEEP'); array(spec.axes, EXPERIMENT_LIMITS.maxParameters, 'INVALID_MULTI_SWEEP');
  const base = compileModel(input).model;
  let count = 1;
  for (const axis of spec.axes) {
    plainOptions(axis, ['nodeId', 'parameter', 'values'], 'INVALID_MULTI_SWEEP'); target(base, axis.nodeId, axis.parameter); array(axis.values, EXPERIMENT_LIMITS.maxGridRuns, 'INVALID_MULTI_SWEEP');
    if (axis.values.some((value) => !finiteParameter(value))) fail('INVALID_MULTI_SWEEP', '반복 계수는 절댓값 10¹² 이하의 유한한 숫자여야 합니다.');
    count *= axis.values.length;
    if (count > EXPERIMENT_LIMITS.maxGridRuns) fail('INVALID_MULTI_SWEEP', '격자의 전체 반복 횟수는 64회 이하여야 합니다.');
  }
  uniqueTargets(spec.axes);
  const session = new ExecutionSession(options, EXPERIMENT_LIMITS.maxGridRuns, started), records: MultiSweepRecord[] = [];
  try {
    if (count > session.limits.maxRuns) fail('INVALID_MULTI_SWEEP', '격자 반복 횟수가 지정한 한도를 초과했습니다.');
    if (options.signal?.aborted) return { status: 'cancelled', records };
    let combinations: ParameterValue[][] = [[]];
    for (const axis of spec.axes) combinations = combinations.flatMap((items) => axis.values.map((value) => [...items, { nodeId: axis.nodeId, parameter: axis.parameter, value }]));
    const variants = combinations.map((parameters) => ({ parameters, compiled: compileVariant(base, parameters) }));
    for (const [index, variant] of variants.entries()) { records.push(await session.run(variant.compiled, variant.parameters, `grid${index + 1}`)); session.progress(records.length, count); if (options.signal?.aborted) return { status: 'cancelled', records }; }
    return { status: 'completed', records };
  } catch (error) {
    if (error instanceof ModelError && error.diagnostics.some((item) => item.code === 'INVALID_MULTI_SWEEP' || item.code === 'INVALID_DASHBOARD_BINDING')) throw error;
    if (error instanceof CandidateExecutionError) records.push(error.record);
    return { status: cancelled(error, options) ? 'cancelled' : 'failed', records, diagnostics: diagnosticsFor(error) };
  }
  finally { session.close(); }
}

function metrics(record: MultiSweepRecord, spec: FitSpec, indexes: number[]): FitCandidate {
  const residuals = spec.measurements.map((item, index) => {
    const predicted = record.result.samples[indexes[index]!]!.values[spec.outputId];
    if (typeof predicted !== 'number' || !Number.isFinite(predicted)) fail('FIT_NONFINITE_OUTPUT', '적합 출력은 유한한 float64 scalar여야 합니다.');
    const residual = predicted - item.value;
    if (!Number.isFinite(residual)) fail('FIT_NONFINITE_ERROR', '잔차가 float64 범위를 초과했습니다.');
    return { time: item.time, measured: item.value, predicted, residual };
  });
  const maximum = Math.max(...residuals.map((item) => Math.abs(item.residual)));
  const scaled = maximum === 0 ? 0 : residuals.reduce((sum, item) => sum + (item.residual / maximum) ** 2, 0);
  const rmse = maximum === 0 ? 0 : maximum * Math.sqrt(scaled / residuals.length), sse = maximum === 0 ? 0 : maximum * maximum * scaled;
  if (!Number.isFinite(sse) || !Number.isFinite(rmse)) fail('FIT_NONFINITE_ERROR', '제곱 오차가 float64 범위를 초과했습니다. 계수·측정값의 크기를 줄여 주세요.');
  return { ...record, residuals, rmse, sse, maxAbsoluteError: maximum };
}
/** Small pivoted solve; at most three normalized parameters. */
function solve(matrix: number[][], rhs: number[], cutoff = 1e-24): number[] | undefined {
  const rows = matrix.map((row, index) => [...row, rhs[index]!]);
  for (let column = 0; column < rhs.length; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < rhs.length; row += 1) if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row;
    if (!Number.isFinite(rows[pivot]![column]) || Math.abs(rows[pivot]![column]!) < cutoff) return;
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];
    const scale = rows[column]![column]!;
    for (let index = column; index <= rhs.length; index += 1) rows[column]![index] = rows[column]![index]! / scale;
    for (let row = 0; row < rhs.length; row += 1) if (row !== column) { const factor = rows[row]![column]!; for (let index = column; index <= rhs.length; index += 1) rows[row]![index] = rows[row]![index]! - factor * rows[column]![index]!; }
  }
  const values = rows.map((row) => row[rhs.length]!);
  return values.every(Number.isFinite) ? values : undefined;
}

/** Bounded local least squares on exact raw observation times. No interpolation or global-optimum claim. */
export async function fitModelParameters(input: CalcModel, spec: FitSpec, options: SweepOptions = {}): Promise<FitResult> {
  const started = performance.now();
  plainOptions(spec, ['parameters', 'outputId', 'measurements', 'unit', 'maxEvaluations'], 'INVALID_FIT');
  array(spec.parameters, EXPERIMENT_LIMITS.maxParameters, 'INVALID_FIT'); array(spec.measurements, EXPERIMENT_LIMITS.maxMeasurements, 'INVALID_FIT');
  const compiledBase = compileModel(input), base = compiledBase.model;
  for (const parameter of spec.parameters) {
    plainOptions(parameter, ['nodeId', 'parameter', 'lower', 'upper', 'initial'], 'INVALID_FIT'); target(base, parameter.nodeId, parameter.parameter);
    if (![parameter.lower, parameter.upper, parameter.initial].every(finiteParameter) || parameter.lower >= parameter.upper || parameter.initial < parameter.lower || parameter.initial > parameter.upper) fail('INVALID_FIT', '유한한 하한 < 상한과 범위 안의 시작 계수를 지정해 주세요.');
  }
  uniqueTargets(spec.parameters);
  if (typeof spec.outputId !== 'string' || spec.outputId.length > 160 || typeof spec.unit !== 'string' || spec.unit.length > 160) fail('INVALID_FIT_OUTPUT', '측정 출력과 단위를 확인해 주세요.');
  const descriptor = compiledBase.outputTypes[spec.outputId];
  if (!descriptor || descriptor.valueType !== 'float64' || descriptor.shape.length !== 0 || descriptor.representation !== undefined) fail('INVALID_FIT_OUTPUT', '적합에는 legacy float64 scalar 출력이 필요합니다.');
  if (descriptor.unit !== spec.unit) fail('FIT_UNIT_MISMATCH', '측정 자료와 출력의 단위가 같아야 합니다.');
  const sampleCount = base.execution.mode === 'static' ? 1 : Math.round((base.execution.stopTime - base.execution.startTime) / base.execution.step) + 1;
  const indexes: number[] = [];
  let previous = -Infinity;
  for (const item of spec.measurements) {
    plainOptions(item, ['time', 'value'], 'INVALID_FIT');
    if (typeof item.time !== 'number' || !Number.isFinite(item.time) || item.time <= previous || typeof item.value !== 'number' || !Number.isFinite(item.value)) fail('INVALID_FIT', '측정값은 유한한 숫자이고 시각은 중복 없이 증가해야 합니다.');
    const index = base.execution.mode === 'static' ? 0 : Math.round((item.time - base.execution.startTime) / base.execution.step), expected = base.execution.startTime + index * base.execution.step;
    // Admit decimal/IEEE roundoff, without letting a large time origin hide a fraction of a step.
    const roundoff = Math.max(1e-12, 8 * Number.EPSILON * Math.max(1, Math.abs(expected), Math.abs(item.time)));
    const gridTolerance = base.execution.mode === 'static' ? roundoff : Math.min(roundoff, base.execution.step / 8);
    if (index < 0 || index >= sampleCount || Math.abs(item.time - expected) > gridTolerance) fail('FIT_MEASUREMENT_GRID', '측정 시각은 모델의 원시 관측 시간 격자와 같아야 합니다. 보간하지 않습니다.');
    if (indexes.at(-1) === index) fail('FIT_MEASUREMENT_GRID', '같은 원시 관측 시각을 중복 지정할 수 없습니다.');
    indexes.push(index); previous = item.time;
  }
  if (spec.measurements.length < spec.parameters.length) fail('INVALID_FIT', '측정 표본 수는 적합할 계수 수 이상이어야 합니다.');
  const maximum = spec.maxEvaluations ?? EXPERIMENT_LIMITS.maxFitEvaluations;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > EXPERIMENT_LIMITS.maxFitEvaluations) fail('INVALID_FIT', '평가 한도는 1~96회여야 합니다.');
  spec = structuredClone(spec);
  const session = new ExecutionSession(options, EXPERIMENT_LIMITS.maxFitEvaluations, started), limit = Math.min(maximum, session.limits.maxRuns);
  let evaluations = 0, best: FitCandidate | undefined;
  const trace: FitResult['trace'] = [];
  const finish = (termination: FitResult['termination'], diagnostics?: Diagnostic[]): FitResult => ({ status: termination === 'cancelled' ? 'cancelled' : termination === 'failed' ? 'failed' : 'completed', termination, evaluations: session.executions, ...(best ? { best } : {}), trace, ...(diagnostics ? { diagnostics } : {}) });
  const spans = spec.parameters.map((parameter) => parameter.upper - parameter.lower);
  const values = (position: number[]): ParameterValue[] => spec.parameters.map((parameter, index) => ({ nodeId: parameter.nodeId, parameter: parameter.parameter, value: Math.max(parameter.lower, Math.min(parameter.upper, parameter.lower + spans[index]! * position[index]!)) }));
  const evaluate = async (position: number[]): Promise<FitCandidate> => {
    const parameters = values(position), compiled = compileVariant(base, parameters);
    const result = await session.run(compiled, parameters, `fit${evaluations + 1}`), candidate = metrics(result, spec, indexes);
    evaluations += 1; trace.push({ evaluation: evaluations, parameters: structuredClone(parameters), rmse: candidate.rmse });
    if (!best || candidate.rmse < best.rmse) best = candidate;
    session.progress(evaluations, limit);
    return candidate;
  };
  const signalScale = Math.max(1, ...spec.measurements.map((item) => Math.abs(item.value))), tolerance = 1e-9 * signalScale;
  try {
    if (options.signal?.aborted) return finish('cancelled');
    let position = spec.parameters.map((parameter, index) => (parameter.initial - parameter.lower) / spans[index]!), current = await evaluate(position), damping = 1e-4;
    while (evaluations < limit) {
      if (options.signal?.aborted) return finish('cancelled');
      const derivatives: number[][] = [];
      for (let axis = 0; axis < position.length; axis += 1) {
        if (evaluations >= limit) return finish('evaluation-limit');
        const probe = [...position], delta = position[axis]! <= 0.9999 ? Math.min(1e-5, 1 - position[axis]!) : -Math.min(1e-5, position[axis]!);
        probe[axis] = position[axis]! + delta;
        const candidate = await evaluate(probe);
        derivatives.push(candidate.residuals.map((item, index) => (item.predicted / signalScale - current.residuals[index]!.predicted / signalScale) / delta));
      }
      if (options.signal?.aborted) return finish('cancelled');
      const residual = current.residuals.map((item) => item.residual / signalScale), hessian = derivatives.map((left) => derivatives.map((right) => left.reduce((sum, value, index) => sum + value * right[index]!, 0))), gradient = derivatives.map((axis) => -axis.reduce((sum, value, index) => sum + value * residual[index]!, 0));
      if (hessian.some((row) => row.some((value) => !Number.isFinite(value))) || gradient.some((value) => !Number.isFinite(value))) fail('FIT_NONFINITE_ERROR', '적합 미분값이 float64 범위를 초과했습니다.');
      const norms = hessian.map((row, index) => Math.sqrt(Math.max(0, row[index]!))), normalized = hessian.map((row, index) => row.map((value, column) => norms[index]! > 1e-12 && norms[column]! > 1e-12 ? value / (norms[index]! * norms[column]!) : 0));
      if (!solve(normalized, normalized.map(() => 1), 1e-8)) return finish('no-improvement', [{ code: 'FIT_IDENTIFIABILITY', message: '측정 자료에서 계수의 독립적인 변화가 관측되지 않습니다. 시작값·측정 구간·모델을 확인해 주세요.' }]);
      if (current.rmse <= tolerance) return finish('converged');
      if (gradient.every((value) => Math.abs(value) <= 1e-15)) return finish('no-improvement', [{ code: 'FIT_NO_IMPROVEMENT', message: '잔차를 더 줄이지 못했습니다. 전역 최적값이나 계수의 유일성을 보장하지 않습니다.' }]);
      let improved = false;
      for (let attempt = 0; attempt < 6 && evaluations < limit; attempt += 1) {
        const matrix = hessian.map((row, index) => row.map((value, column) => value + (index === column ? damping * Math.max(1e-12, hessian[index]![index]!) : 0))), step = solve(matrix, gradient);
        if (!step) { damping *= 10; continue; }
        const trust = Math.max(1, ...step.map((value) => Math.abs(value) / 0.35)), proposed = position.map((value, index) => Math.max(0, Math.min(1, value + step[index]! / trust)));
        if (proposed.every((value, index) => Math.abs(value - position[index]!) < 1e-12)) { damping *= 10; continue; }
        const candidate = await evaluate(proposed);
        if (candidate.rmse < current.rmse) { position = proposed; current = candidate; damping = Math.max(1e-12, damping / 5); improved = true; break; }
        damping *= 10;
        if (options.signal?.aborted) return finish('cancelled');
      }
      if (!improved) return finish(evaluations >= limit ? 'evaluation-limit' : 'no-improvement');
    }
    return finish('evaluation-limit');
  } catch (error) { return finish(cancelled(error, options) ? 'cancelled' : 'failed', diagnosticsFor(error)); }
  finally { session.close(); }
}
