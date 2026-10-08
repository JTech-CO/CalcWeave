import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { fitModelParameters, runMultiParameterSweep, type FitSpec, type MultiSweepSpec, type SweepBudget, type SweepOptions } from '../packages/experiments/src';
import { ModelError, type CalcModel, type CalcNode, type RunResult } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';

const node = (id: string, blockType: CalcNode['blockType'], parameters: Record<string, unknown> = {}): CalcNode => ({ id, blockType, blockVersion: 1, label: id, parameters, ...(blockType === 'source.clock' ? { unit: '1' } : {}) });
const edge = (source: string, destination: string, targetPort = 'in') => ({ id: `${source}-${destination}-${targetPort}`, source: { nodeId: source, portId: 'out' }, target: { nodeId: destination, portId: targetPort } });
function affine(): CalcModel {
  return { schemaVersion: 1, modelId: 'm19-affine', name: 'Affine', nodes: [node('clock', 'source.clock'), node('gain', 'math.gain', { gain: 0.5 }), node('offset', 'source.constant', { value: 0 }), node('sum', 'math.sum'), node('view', 'sink.scope')], edges: [edge('clock', 'gain'), edge('gain', 'sum', 'a'), edge('offset', 'sum', 'b'), edge('sum', 'view')], execution: { mode: 'continuous', startTime: 0, stopTime: 2, step: 0.25 }, layout: {} };
}
function scalar(): CalcModel {
  return { schemaVersion: 1, modelId: 'm19-static', name: 'Scalar', nodes: [node('source', 'source.constant', { value: 2 }), node('gain', 'math.gain', { gain: 1 }), node('view', 'sink.display')], edges: [edge('source', 'gain'), edge('gain', 'view')], execution: { mode: 'static', startTime: 0, stopTime: 1, step: 0.1 }, layout: {} };
}
const grid = (): MultiSweepSpec => ({ axes: [{ nodeId: 'source', parameter: 'value', values: [1, 2] }, { nodeId: 'gain', parameter: 'gain', values: [2, 3, 4] }] });
const fit = (): FitSpec => ({ parameters: [{ nodeId: 'gain', parameter: 'gain', lower: -5, upper: 5, initial: 0.5 }, { nodeId: 'offset', parameter: 'value', lower: -3, upper: 3, initial: 0 }], outputId: 'view', unit: '1', measurements: Array.from({ length: 9 }, (_, index) => ({ time: index / 4, value: 2.75 * index / 4 - 1.25 })) });
const execute = (model: CalcModel, budget: SweepBudget): Promise<RunResult> => runModel(compileModel(model), budget);
async function rejects(action: () => Promise<unknown>, expected: string): Promise<void> {
  try { await action(); throw new Error('Did not reject'); } catch (error) { expect(error).toBeInstanceOf(ModelError); expect((error as ModelError).diagnostics.map((item) => item.code)).toContain(expected); }
}

describe('M19 Cartesian exploration', () => {
  it('enumerates every two-coefficient combination deterministically and preserves original/model hashes', async () => {
    const model = scalar(), original = structuredClone(model), spec = grid(), originalSpec = structuredClone(spec);
    const result = await runMultiParameterSweep(model, spec);
    expect(result.status).toBe('completed'); expect(result.records.map((item) => item.parameters.map((parameter) => parameter.value))).toEqual([[1, 2], [1, 3], [1, 4], [2, 2], [2, 3], [2, 4]]);
    expect(result.records.map((item) => item.result.samples[0]!.values.view)).toEqual([2, 3, 4, 4, 6, 8]);
    for (const record of result.records) { expect(record.modelHash).toBe(createHash('sha256').update(compileModel(record.model).semanticKey).digest('hex')); expect(record.manifest.modelHash).toBe(record.modelHash); }
    expect(model).toEqual(original); expect(spec).toEqual(originalSpec);
    result.records[0]!.model.nodes[0]!.parameters.value = 99; expect(model).toEqual(original); expect(result.records[1]!.model.nodes[0]!.parameters.value).toBe(1);
  });
  it('runs three axes while validating all variants before execution', async () => {
    const model = scalar(); model.nodes.splice(2, 0, node('second', 'math.gain', { gain: 1 })); model.edges = [edge('source', 'gain'), edge('gain', 'second'), edge('second', 'view')];
    const result = await runMultiParameterSweep(model, { axes: [...grid().axes, { nodeId: 'second', parameter: 'gain', values: [-1, 1] }] });
    expect(result.records).toHaveLength(12); expect(result.records.map((item) => item.result.samples[0]!.values.view)).toEqual([-2, 2, -3, 3, -4, 4, -4, 4, -6, 6, -8, 8]);
    model.dashboard = [{ id: 'control', kind: 'slider', title: 'Gain', nodeId: 'gain', parameter: 'gain', min: 0, max: 3, step: 1 }];
    let calls = 0; await rejects(() => runMultiParameterSweep(model, grid(), { execute: async (...args) => { calls += 1; return execute(...args); } }), 'INVALID_DASHBOARD_BINDING'); expect(calls).toBe(0);
  });
  it('shares actual operations and timestamp/output recording counts over the full grid', async () => {
    const budgets: SweepBudget[] = []; const result = await runMultiParameterSweep(scalar(), grid(), { maxRecordedValues: 4, execute: (...args) => { budgets.push(args[1]); return execute(...args); } });
    expect(result.status).toBe('failed'); expect(result.records).toHaveLength(2); expect(budgets.map((item) => item.maxRecordedValues)).toEqual([4, 2]); expect(result.diagnostics![0]!.code).toBe('SWEEP_RECORD_BUDGET');
    const operation = await runMultiParameterSweep(scalar(), grid(), { maxOperations: 6 }); expect(operation.status).toBe('failed'); expect(operation.records).toHaveLength(2); expect(operation.diagnostics![0]!.code).toBe('SWEEP_OPERATION_BUDGET');
  });
  it('freezes executor model and budget, reports bounded progress, and cancels between runs', async () => {
    const controller = new AbortController(), progress: number[] = [];
    const result = await runMultiParameterSweep(scalar(), grid(), { signal: controller.signal, execute: async (model, budget) => { expect(Object.isFrozen(model.nodes[0]!.parameters)).toBe(true); expect(Object.isFrozen(budget)).toBe(true); return execute(model, budget); }, onProgress: (update) => { progress.push(update.completed); expect(update.records).toEqual([]); expect(update.total).toBe(6); controller.abort(); } });
    expect(result.status).toBe('cancelled'); expect(result.records).toHaveLength(1); expect(progress).toEqual([1]);
    expect(await runMultiParameterSweep(scalar(), grid(), { signal: controller.signal })).toEqual({ status: 'cancelled', records: [] });
  });
  it('preserves validated partial grid records with their truthful failed or cancelled status', async () => {
    const partial = await runMultiParameterSweep(scalar(), grid(), { execute: async (...args) => { const result = await execute(...args); throw new ModelError([{ code: 'GRID_PARTIAL', message: 'Partial' }], { ...result, status: 'failed' }); } });
    expect(partial.status).toBe('failed'); expect(partial.records).toHaveLength(1); expect(partial.records[0]!.result.status).toBe('failed'); expect(partial.diagnostics![0]!.code).toBe('GRID_PARTIAL');
    const cancelled = await runMultiParameterSweep(scalar(), grid(), { execute: async (...args) => ({ ...await execute(...args), status: 'cancelled' }) }); expect(cancelled.status).toBe('cancelled'); expect(cancelled.records).toHaveLength(1); expect(cancelled.records[0]!.result.status).toBe('cancelled');
  });
  it.each([
    { axes: [] }, { axes: [...grid().axes, ...grid().axes] }, { axes: [grid().axes[0], grid().axes[0]] },
    { axes: [{ nodeId: 'view', parameter: 'value', values: [1] }] },
    { axes: [{ nodeId: 'gain', parameter: 'gain', values: [Infinity] }] },
    { axes: [{ nodeId: 'gain', parameter: 'gain', values: [1e13] }] },
    { axes: [{ nodeId: 'gain', parameter: 'gain', values: [] }] },
    { axes: grid().axes.map((axis) => ({ ...axis, values: Array.from({ length: 9 }, (_, index) => index) })) },
  ])('rejects unsupported axes before execution: %j', async (spec) => {
    let calls = 0; await expect(runMultiParameterSweep(scalar(), spec as MultiSweepSpec, { execute: async (...args) => { calls += 1; return execute(...args); } })).rejects.toBeInstanceOf(ModelError); expect(calls).toBe(0);
  });
  it('rejects getters, sparse axes and unsafe options without invoking accessor code', async () => {
    let calls = 0; const values = [1]; Object.defineProperty(values, '0', { enumerable: true, get: () => { calls += 1; return 1; } });
    await rejects(() => runMultiParameterSweep(scalar(), { axes: [{ nodeId: 'gain', parameter: 'gain', values }] }), 'INVALID_MULTI_SWEEP');
    const axes = new Array<MultiSweepSpec['axes'][number]>(1); await rejects(() => runMultiParameterSweep(scalar(), { axes }), 'INVALID_MULTI_SWEEP');
    const options = {}; Object.defineProperty(options, 'maxRuns', { enumerable: true, get: () => { calls += 1; return 1; } });
    await rejects(() => runMultiParameterSweep(scalar(), grid(), options), 'INVALID_EXPERIMENT_OPTIONS'); expect(calls).toBe(0);
  });
  it.each([{ maxRuns: 65 }, { maxRuns: 0 }, { maxWallMs: 30_001 }, { maxRecordedValues: 1_000_001 }, { maxOperations: 50_000_001 }])('cannot raise the shared hard limit: %j', async (options) => { await rejects(() => runMultiParameterSweep(scalar(), grid(), options), 'INVALID_EXPERIMENT_OPTIONS'); });
  it('rejects a Cartesian grid above a lower configured run limit', async () => { await rejects(() => runMultiParameterSweep(scalar(), grid(), { maxRuns: 5 }), 'INVALID_MULTI_SWEEP'); });
});

describe('M19 measured bounded local least squares', () => {
  it('restores known affine gain and offset using real engine samples, exact residuals and reproducible snapshots', async () => {
    const model = affine(), original = structuredClone(model), measurements = fit(), originalSpec = structuredClone(measurements);
    const result = await fitModelParameters(model, measurements);
    expect(result.status).toBe('completed'); expect(result.termination).toBe('converged'); expect(result.evaluations).toBeLessThan(40);
    expect(result.best!.parameters[0]!.value).toBeCloseTo(2.75, 7); expect(result.best!.parameters[1]!.value).toBeCloseTo(-1.25, 7); expect(result.best!.rmse).toBeLessThan(1e-8);
    expect(result.best!.sse).toBeCloseTo(result.best!.residuals.reduce((sum, item) => sum + item.residual ** 2, 0), 15);
    expect(result.best!.maxAbsoluteError).toBe(Math.max(...result.best!.residuals.map((item) => Math.abs(item.residual))));
    result.best!.residuals.forEach((item, index) => { expect(item.predicted).toBe(result.best!.result.samples[index]!.values.view); expect(item.residual).toBe(item.predicted - item.measured); });
    const replay = await runModel(compileModel(result.best!.model)); expect(replay.samples).toEqual(result.best!.result.samples); expect(result.best!.manifest.modelHash).toBe(result.best!.modelHash);
    expect(model).toEqual(original); expect(measurements).toEqual(originalSpec);
    const repeat = await fitModelParameters(model, measurements); expect(repeat.trace).toEqual(result.trace); expect(repeat.best!.modelHash).toBe(result.best!.modelHash);
  });
  it('restores continuous amplitude and decay against an independent analytic oracle', async () => {
    const model: CalcModel = { schemaVersion: 1, modelId: 'm19-decay', name: 'Decay', nodes: [node('state', 'continuous.integrator', { initial: 1 }), node('decay', 'math.gain', { gain: -0.3 }), node('amplitude', 'math.gain', { gain: 1 }), node('view', 'sink.scope')], edges: [edge('state', 'decay'), edge('decay', 'state'), edge('state', 'amplitude'), edge('amplitude', 'view')], execution: { mode: 'continuous', startTime: 0, stopTime: 3, step: 0.25, solver: { initialStep: 0.01, maxStep: 0.01 } }, layout: {} };
    const spec: FitSpec = { parameters: [{ nodeId: 'amplitude', parameter: 'gain', lower: 0.1, upper: 4, initial: 1 }, { nodeId: 'decay', parameter: 'gain', lower: -2, upper: -0.01, initial: -0.3 }], outputId: 'view', unit: '1', measurements: Array.from({ length: 13 }, (_, index) => ({ time: index / 4, value: 2.3 * Math.exp(-0.7 * index / 4) })) };
    const result = await fitModelParameters(model, spec);
    expect(result.termination).toBe('converged'); expect(result.best!.parameters[0]!.value).toBeCloseTo(2.3, 6); expect(result.best!.parameters[1]!.value).toBeCloseTo(-0.7, 6); expect(result.best!.rmse).toBeLessThan(1e-8);
  });
  it('accepts an exact observation subset and single static scalar measurement', async () => {
    const spec = fit(); spec.measurements = spec.measurements.filter((_, index) => index % 2 === 0); const subset = await fitModelParameters(affine(), spec); expect(subset.termination).toBe('converged'); expect(subset.best!.residuals.map((item) => item.time)).toEqual([0, 0.5, 1, 1.5, 2]);
    const constant = await fitModelParameters(scalar(), { parameters: [{ nodeId: 'gain', parameter: 'gain', lower: 0, upper: 6, initial: 1 }], outputId: 'view', unit: '1', measurements: [{ time: 0, value: 7 }] }); expect(constant.termination).toBe('converged'); expect(constant.best!.parameters[0]!.value).toBeCloseTo(3.5, 7);
  });
  it('accepts decimal timestamp roundoff while rejecting half-steps at a large time origin', async () => {
    const decimalModel = affine(); decimalModel.execution.step = 0.1; decimalModel.execution.stopTime = 0.5;
    const decimal = fit(); decimal.measurements = [{ time: 0.1, value: -0.975 }, { time: 0.3, value: -0.425 }]; decimal.maxEvaluations = 1;
    const accepted = await fitModelParameters(decimalModel, decimal); expect(accepted.status).toBe('completed'); expect(accepted.best!.result.samples[3]!.time).toBe(0.30000000000000004);
    const largeOrigin = affine(), start = 100_000, step = 2 ** -20; largeOrigin.execution = { mode: 'continuous', startTime: start, stopTime: start + 4 * step, step };
    const spec: FitSpec = { parameters: [{ nodeId: 'gain', parameter: 'gain', lower: 0, upper: 3, initial: 0.5 }], outputId: 'view', unit: '1', maxEvaluations: 1, measurements: [{ time: start + 0.5 * step, value: 1 }, { time: start + 1.5 * step, value: 2 }] };
    let calls = 0; await rejects(() => fitModelParameters(largeOrigin, spec, { execute: async (...args) => { calls += 1; return execute(...args); } }), 'FIT_MEASUREMENT_GRID'); expect(calls).toBe(0);
    spec.measurements = [0, 1, 4].map((index) => ({ time: start + index * step, value: (start + index * step) / 2 }));
    const onGrid = await fitModelParameters(largeOrigin, spec); expect(onGrid.status).toBe('completed'); expect(onGrid.best!.residuals.map((item) => item.time)).toEqual(spec.measurements.map((item) => item.time));
  });
  it('fits noisy data to independently calculated least-squares coefficients and reports nonzero error', async () => {
    const spec = fit(); spec.measurements.forEach((item, index) => { item.value += index % 2 ? 0.1 : -0.08; });
    const n = spec.measurements.length, sx = spec.measurements.reduce((sum, item) => sum + item.time, 0), sy = spec.measurements.reduce((sum, item) => sum + item.value, 0), sxx = spec.measurements.reduce((sum, item) => sum + item.time ** 2, 0), sxy = spec.measurements.reduce((sum, item) => sum + item.time * item.value, 0), slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), intercept = (sy - slope * sx) / n;
    const result = await fitModelParameters(affine(), spec); expect(result.best!.parameters[0]!.value).toBeCloseTo(slope, 6); expect(result.best!.parameters[1]!.value).toBeCloseTo(intercept, 6); expect(result.best!.rmse).toBeGreaterThan(0.05); expect(result.termination).toBe('no-improvement');
  });
  it('enforces bounds even when the optimum lies outside the requested interval', async () => {
    const spec: FitSpec = { parameters: [{ nodeId: 'gain', parameter: 'gain', lower: 0, upper: 2, initial: 0 }], outputId: 'view', unit: '1', measurements: [{ time: 0, value: 10 }] };
    const result = await fitModelParameters(scalar(), spec); expect(result.best!.parameters[0]!.value).toBe(2); expect(result.best!.rmse).toBe(6); expect(result.termination).toBe('no-improvement'); result.trace.forEach((item) => expect(item.parameters[0]!.value).toBeGreaterThanOrEqual(0));
  });
  it('marks flat sensitivity and dependent coefficients as non-identifiable even at zero residual', async () => {
    const model = scalar(); model.nodes[0]!.parameters.value = 0;
    const flat = await fitModelParameters(model, { parameters: [{ nodeId: 'gain', parameter: 'gain', lower: -2, upper: 2, initial: 1 }], outputId: 'view', unit: '1', measurements: [{ time: 0, value: 0 }] }); expect(flat.termination).toBe('no-improvement'); expect(flat.diagnostics![0]!.code).toBe('FIT_IDENTIFIABILITY');
    const dependent = affine(); dependent.nodes[0]!.blockType = 'source.constant'; dependent.nodes[0]!.parameters.value = 1;
    const report = await fitModelParameters(dependent, fit()); expect(report.termination).toBe('no-improvement'); expect(report.diagnostics![0]!.code).toBe('FIT_IDENTIFIABILITY');
  });
  it('returns the best complete candidate when the evaluation limit is reached', async () => {
    const result = await fitModelParameters(affine(), { ...fit(), maxEvaluations: 3 }); expect(result.status).toBe('completed'); expect(result.termination).toBe('evaluation-limit'); expect(result.evaluations).toBe(3); expect(result.best!.rmse).toBe(Math.min(...result.trace.map((item) => item.rmse)));
    const configured = await fitModelParameters(affine(), fit(), { maxRuns: 2 }); expect(configured.evaluations).toBe(2); expect(configured.termination).toBe('evaluation-limit');
  });
  it.each(['off-grid', 'duplicate', 'descending', 'nonfinite', 'unit', 'few', 'huge', 'reversed', 'initial', 'limit', 'extra'])('rejects invalid measured fit before execution: %s', async (mode) => {
    const spec = fit();
    if (mode === 'off-grid') spec.measurements[1]!.time = 0.3;
    if (mode === 'duplicate') spec.measurements[1]!.time = 0;
    if (mode === 'descending') spec.measurements.reverse();
    if (mode === 'nonfinite') spec.measurements[1]!.value = Infinity;
    if (mode === 'unit') spec.unit = 'm';
    if (mode === 'few') spec.measurements = [spec.measurements[0]!];
    if (mode === 'huge') spec.measurements = Array.from({ length: 1001 }, (_, index) => ({ time: index / 4, value: 0 }));
    if (mode === 'reversed') spec.parameters[0]!.upper = -6;
    if (mode === 'initial') spec.parameters[0]!.initial = 10;
    if (mode === 'limit') spec.maxEvaluations = 97;
    if (mode === 'extra') Object.assign(spec, { script: 'alert(1)' });
    let calls = 0; await expect(fitModelParameters(affine(), spec, { execute: async (...args) => { calls += 1; return execute(...args); } })).rejects.toBeInstanceOf(ModelError); expect(calls).toBe(0);
  });
  it('does not implicitly coerce vector, boolean or typed signals into measured scalar data', async () => {
    for (const value of [[1, 2], true, { kind: 'typed', dtype: 'float64', shape: [], data: [2] }]) {
      const model = scalar(); model.nodes = [node('source', typeof value === 'object' && !Array.isArray(value) ? 'source.typed' : 'source.constant', { value }), node('coefficient', 'source.constant', { value: 1 }), node('view', 'sink.display')]; model.edges = [edge('source', 'view')];
      await rejects(() => fitModelParameters(model, { parameters: [{ nodeId: 'coefficient', parameter: 'value', lower: 0, upper: 2, initial: 1 }], outputId: 'view', unit: '1', measurements: [{ time: 0, value: 1 }] }), 'INVALID_FIT_OUTPUT');
    }
  });
  it('rejects measurement and parameter accessors without running them', async () => {
    let calls = 0; const spec = fit(); Object.defineProperty(spec.measurements[0], 'value', { enumerable: true, get: () => { calls += 1; return 1; } }); await rejects(() => fitModelParameters(affine(), spec), 'INVALID_FIT'); expect(calls).toBe(0);
    const parameters = fit(); Object.defineProperty(parameters.parameters[0], 'initial', { enumerable: true, get: () => { calls += 1; return 1; } }); await rejects(() => fitModelParameters(affine(), parameters), 'INVALID_FIT'); expect(calls).toBe(0);
  });
  it('snapshots the validated specification before async progress callbacks can change it', async () => {
    const spec = fit(), result = await fitModelParameters(affine(), spec, { onProgress: () => { spec.measurements[0]!.value = 99; spec.parameters[0]!.upper = 1; } }); expect(result.termination).toBe('converged'); expect(result.best!.residuals[0]!.measured).toBe(-1.25); expect(result.best!.parameters[0]!.value).toBeCloseTo(2.75, 7);
  });
});

describe('M19 executor trust and interruption', () => {
  it.each(['operations', 'time', 'shape', 'accessor', 'elapsed', 'partial'])('never ranks an invalid or incomplete executor candidate: %s', async (mode) => {
    let accessed = false;
    const result = await fitModelParameters(affine(), fit(), { execute: async (...args) => {
      const snapshot = await execute(...args);
      if (mode === 'operations') snapshot.resources!.operations = args[1].maxOperations + 1;
      if (mode === 'time') snapshot.samples[0]!.time = 7;
      if (mode === 'shape') snapshot.samples[0]!.values.view = [1, 2];
      if (mode === 'accessor') Object.defineProperty(snapshot, 'elapsedMs', { enumerable: true, get: () => { accessed = true; return 0; } });
      if (mode === 'elapsed') snapshot.elapsedMs = Infinity;
      if (mode === 'partial') throw new ModelError([{ code: 'INTERRUPTED_TEST', message: 'Partial' }], { ...snapshot, status: 'failed' });
      return snapshot;
    } });
    expect(result.status).toBe('failed'); expect(result.evaluations).toBe(1); expect(result.best).toBeUndefined(); expect(result.trace).toEqual([]); expect(accessed).toBe(false);
  });
  it('retains the earlier complete best when a later evaluation fails', async () => {
    let calls = 0; const report = await fitModelParameters(affine(), fit(), { execute: async (...args) => { const result = await execute(...args); calls += 1; if (calls === 2) return { ...result, status: 'failed' }; return result; } });
    expect(report.status).toBe('failed'); expect(report.evaluations).toBe(2); expect(report.best!.result.status).toBe('completed'); expect(report.trace).toHaveLength(1);
  });
  it('uses one shared fit computation and recording budget over Jacobian probes', async () => {
    const model = scalar(), spec: FitSpec = { parameters: [{ nodeId: 'gain', parameter: 'gain', lower: 0, upper: 5, initial: 1 }], outputId: 'view', unit: '1', measurements: [{ time: 0, value: 8 }] };
    const result = await fitModelParameters(model, spec, { maxRecordedValues: 4 }); expect(result.evaluations).toBe(2); expect(result.status).toBe('failed'); expect(result.diagnostics![0]!.code).toBe('SWEEP_RECORD_BUDGET');
    const operation = await fitModelParameters(model, spec, { maxOperations: 6 }); expect(operation.evaluations).toBe(2); expect(operation.status).toBe('failed'); expect(operation.diagnostics![0]!.code).toBe('SWEEP_OPERATION_BUDGET');
  });
  it('cancels a pending uncooperative executor immediately and enforces a hard deadline', async () => {
    const controller = new AbortController(); const promise = fitModelParameters(affine(), fit(), { signal: controller.signal, execute: async () => new Promise<RunResult>(() => {}) }); setTimeout(() => controller.abort(), 20);
    const cancelled = await promise; expect(cancelled.status).toBe('cancelled'); expect(cancelled.best).toBeUndefined(); expect(cancelled.evaluations).toBe(1);
    const timeout = await runMultiParameterSweep(scalar(), grid(), { maxWallMs: 30, execute: async () => new Promise<RunResult>(() => {}) }); expect(timeout.status).toBe('failed'); expect(timeout.diagnostics![0]!.code).toBe('SWEEP_WALL_BUDGET');
  });
  it('handles synchronous executor cancellation without waiting for the deadline', async () => {
    const controller = new AbortController(), started = performance.now();
    const report = await fitModelParameters(affine(), fit(), { signal: controller.signal, execute: async () => { controller.abort(); return new Promise<RunResult>(() => {}); } });
    expect(report.status).toBe('cancelled'); expect(performance.now() - started).toBeLessThan(500); expect(report.evaluations).toBe(1);
  });
  it('never ranks a validated returned cancellation snapshot', async () => {
    const result = await fitModelParameters(affine(), fit(), { execute: async (...args) => ({ ...await execute(...args), status: 'cancelled' }) }); expect(result.status).toBe('cancelled'); expect(result.best).toBeUndefined(); expect(result.evaluations).toBe(1);
  });
  it('counts reported elapsed time and does not rank a candidate above the shared deadline', async () => {
    const report = await fitModelParameters(affine(), fit(), { maxWallMs: 100, execute: async (...args) => ({ ...await execute(...args), elapsedMs: 101 }) }); expect(report.status).toBe('failed'); expect(report.best).toBeUndefined(); expect(report.diagnostics![0]!.code).toBe('SWEEP_WALL_BUDGET');
  });
  it('stops safely after progress cancellation with only completed prior candidates', async () => {
    const controller = new AbortController(), report = await fitModelParameters(affine(), fit(), { signal: controller.signal, onProgress: (progress) => { expect(progress.completed).toBe(1); controller.abort(); } }); expect(report.status).toBe('cancelled'); expect(report.evaluations).toBe(1); expect(report.best!.result.status).toBe('completed');
    const before = await fitModelParameters(affine(), fit(), { signal: controller.signal }); expect(before.status).toBe('cancelled'); expect(before.evaluations).toBe(0); expect(before.best).toBeUndefined();
  });
});
