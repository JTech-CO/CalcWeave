import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { runUncertaintyEnsemble, ENSEMBLE_LIMITS, type EnsembleSpec, type EnsembleOptions } from '../packages/experiments/src/uncertainty';
import type { SweepBudget } from '../packages/experiments/src';
import { ModelError, type CalcModel, type CalcNode, type RunResult } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';

const node = (id: string, blockType: string, parameters: Record<string, unknown> = {}): CalcNode => ({ id, blockType, blockVersion: 1, label: id, parameters });
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source: { nodeId: source, portId: 'out' }, target: { nodeId: target, portId: 'in' } });
function model(mode: CalcModel['execution']['mode'] = 'static'): CalcModel {
  return { schemaVersion: 1, modelId: 'm23-core', name: 'Ensemble oracle', nodes: [node('source', 'source.constant', { value: 2 }), node('gain', 'math.gain', { gain: 3 }), node('view', 'sink.display')], edges: [edge('source', 'gain'), edge('gain', 'view')], execution: { mode, startTime: 0, stopTime: 1, step: 0.25 }, layout: {} };
}
const spec = (): EnsembleSpec => ({ seed: 0, sampleCount: 4, parameters: [{ nodeId: 'source', parameter: 'value', distribution: { kind: 'uniform', lower: -2, upper: 2 } }], outputId: 'view', unit: '1' });
const execute = (input: CalcModel, budget: SweepBudget): Promise<RunResult> => runModel(compileModel(input), budget);
async function rejects(action: () => Promise<unknown>, code: string): Promise<void> {
  try { await action(); throw new Error('did not reject'); } catch (error) { expect(error).toBeInstanceOf(ModelError); expect((error as ModelError).diagnostics.map((item) => item.code)).toContain(code); }
}
function independentDraws(seed: number, count: number): number[] {
  let state = BigInt(seed);
  return Array.from({ length: count }, () => { state = (1_664_525n * state + 1_013_904_223n) % 4_294_967_296n; return (Number(state) + 0.5) / 4_294_967_296; });
}
function quantile(sorted: number[], p: number): number { const position = (sorted.length - 1) * p, lower = Math.floor(position), t = position - lower; return sorted[lower]! * (1 - t) + sorted[Math.min(lower + 1, sorted.length - 1)]! * t; }

describe('M23 seeded bounded uncertainty plans', () => {
  it('matches literal LCG states including seed zero, records immutable provenance and preserves input', async () => {
    const input = model(), original = structuredClone(input), request = spec(), originalSpec = structuredClone(request), result = await runUncertaintyEnsemble(input, request);
    const states = [1_013_904_223, 1_196_435_762, 3_519_870_697, 2_868_466_484];
    expect(result.records.map((record) => record.parameters[0]!.value)).toEqual(states.map((state) => -2 + 4 * (state + 0.5) / 4_294_967_296));
    expect(result.status).toBe('completed'); expect(result.counts).toEqual({ requested: 4, attempted: 4, completed: 4, failed: 0, cancelled: 0, notStarted: 0 });
    expect(result.prng).toEqual({ algorithm: 'lcg32-1664525-1013904223', drawOrder: 'sample-then-parameter', uniform: '(state+0.5)/2^32' });
    expect(result.baseSemanticHash).toBe(createHash('sha256').update(compileModel(input).semanticKey).digest('hex'));
    for (const record of result.records) {
      expect(record.id).toMatch(/^sample[1-4]$/); expect(record.status).toBe('completed'); expect(record.run!.manifest.modelHash).toBe(record.run!.modelHash);
      expect(record.run!.modelHash).toBe(createHash('sha256').update(compileModel(record.run!.model).semanticKey).digest('hex'));
      expect(record.run!.result.samples[0]!.values.view).toBe(record.parameters[0]!.value * 3);
    }
    expect(input).toEqual(original); expect(request).toEqual(originalSpec);
    result.baseModel.nodes[0]!.parameters.value = 100; result.records[0]!.run!.model.nodes[0]!.parameters.value = 200; result.spec.seed = 100;
    expect(input).toEqual(original); expect(request).toEqual(originalSpec); expect(result.records[1]!.run!.model.nodes[0]!.parameters.value).toBe(result.records[1]!.parameters[0]!.value);
  });
  it('repeats all draws and hashes for the same seed and changes the plan for another seed', async () => {
    const first = await runUncertaintyEnsemble(model(), spec()), second = await runUncertaintyEnsemble(model(), spec()), third = await runUncertaintyEnsemble(model(), { ...spec(), seed: 0xffff_ffff });
    expect(first.records.map((item) => [item.parameters, item.run!.modelHash])).toEqual(second.records.map((item) => [item.parameters, item.run!.modelHash]));
    expect(third.records.map((item) => item.parameters)).not.toEqual(first.records.map((item) => item.parameters));
  });
  it.each([-2, -0.5, 2])('matches independent triangular inverse CDF including an endpoint mode %s', async (mode) => {
    const request = spec(); request.parameters[0]!.distribution = { kind: 'triangular', lower: -2, mode, upper: 2 };
    const result = await runUncertaintyEnsemble(model(), request), draws = independentDraws(0, 4);
    result.records.forEach((record, index) => {
      const u = draws[index]!, split = (mode + 2) / 4, expected = u < split ? -2 + Math.sqrt(u * 4 * (mode + 2)) : 2 - Math.sqrt((1 - u) * 4 * (2 - mode));
      expect(record.parameters[0]!.value).toBe(expected); expect(record.parameters[0]!.value).toBeGreaterThan(-2); expect(record.parameters[0]!.value).toBeLessThan(2);
    });
  });
  it('draws independent parameters in sample then parameter order and supports three coefficients', async () => {
    const input = model(); input.nodes.splice(2, 0, node('second', 'math.gain', { gain: 1 })); input.edges = [edge('source', 'gain'), edge('gain', 'second'), edge('second', 'view')];
    const request = spec(); request.parameters.push({ nodeId: 'gain', parameter: 'gain', distribution: { kind: 'uniform', lower: 1, upper: 2 } }, { nodeId: 'second', parameter: 'gain', distribution: { kind: 'uniform', lower: 4, upper: 5 } });
    const result = await runUncertaintyEnsemble(input, request), draws = independentDraws(0, 12);
    expect(result.records.map((record, index) => record.parameters.map((parameter) => parameter.value))).toEqual(Array.from({ length: 4 }, (_, index) => [-2 + 4 * draws[3 * index]!, 1 + draws[3 * index + 1]!, 4 + draws[3 * index + 2]!]));
    result.records.forEach((record) => expect(record.run!.result.samples[0]!.values.view).toBe(record.parameters.reduce((product, parameter) => product * parameter.value, 1)));
  });
  it('accepts a finite root Input value and magnitude boundaries', async () => {
    const input = model(); input.nodes[0]!.blockType = 'io.input'; const request = spec(); request.parameters[0]!.distribution = { kind: 'uniform', lower: -1e12, upper: 1e12 };
    const result = await runUncertaintyEnsemble(input, request); expect(result.status).toBe('completed'); expect(result.records.every((record) => Math.abs(record.parameters[0]!.value) <= 1e12)).toBe(true);
  });
  it('precompiles every candidate before execution and prevents callback mutation from changing the plan', async () => {
    const input = model(), request = spec(), expected = await runUncertaintyEnsemble(input, request), calls: number[] = [];
    const result = await runUncertaintyEnsemble(input, request, { execute: async (snapshot, budget) => { expect(Object.isFrozen(snapshot.nodes[0]!.parameters)).toBe(true); expect(Object.isFrozen(budget)).toBe(true); calls.push(snapshot.nodes[0]!.parameters.value as number); return execute(snapshot, budget); }, onProgress: (progress) => { expect(Object.isFrozen(progress)).toBe(true); input.nodes[0]!.parameters.value = 999; request.seed = 100; request.parameters[0]!.distribution.upper = 1e12; } });
    expect(calls).toEqual(expected.records.map((record) => record.parameters[0]!.value)); expect(result.spec).toEqual(expected.spec); expect(result.baseModel).toEqual(expected.baseModel);
    const invalid = model(); invalid.dashboard = [{ id: 'limited', kind: 'slider', title: 'Value', nodeId: 'source', parameter: 'value', min: 0, max: 4, step: 1 }];
    let executions = 0; await rejects(() => runUncertaintyEnsemble(invalid, spec(), { execute: async (...args) => { executions += 1; return execute(...args); } }), 'INVALID_DASHBOARD_BINDING'); expect(executions).toBe(0);
  });
  it.each([2, 64])('supports sample count boundary %s', async (sampleCount) => { expect((await runUncertaintyEnsemble(model(), { ...spec(), sampleCount })).counts.completed).toBe(sampleCount); });
});

describe('M23 exact-grid completed-run statistics', () => {
  it.each(['static', 'discrete', 'continuous'] as const)('matches independent analytic affine statistics in %s mode', async (mode) => {
    const input = model(mode), result = await runUncertaintyEnsemble(input, spec()), values = independentDraws(0, 4).map((u) => (-2 + 4 * u) * 3).sort((a, b) => a - b);
    const mean = values.reduce((sum, value) => sum + value, 0) / 4, sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 3);
    expect(result.statistics.status).toBe('completed'); expect(result.statistics.recordIds).toEqual(['sample1', 'sample2', 'sample3', 'sample4']);
    expect(result.statistics.standardDeviationConvention).toBe('sample-n-minus-one'); expect(result.statistics.quantileConvention).toBe('linear-n-minus-one');
    expect(result.statistics.points).toHaveLength(mode === 'static' ? 1 : 5);
    for (const [index, point] of result.statistics.points.entries()) {
      expect(point.time).toBe(index * 0.25); expect(point.count).toBe(4); expect(point.mean).toBeCloseTo(mean, 13); expect(point.standardDeviation).toBeCloseTo(sd, 13);
      expect(point.minimum).toBe(values[0]); expect(point.maximum).toBe(values[3]); expect(point.q05).toBeCloseTo(quantile(values, 0.05), 13); expect(point.median).toBeCloseTo(quantile(values, 0.5), 13); expect(point.q95).toBeCloseTo(quantile(values, 0.95), 13);
    }
    expect(result.resources.recordedValues).toBe(4 * (mode === 'static' ? 1 : 5) * 2); expect(result.resources.operations).toBeGreaterThan(0);
  });
  it('runs an actual dynamic recurrence with independently calculated raw observations', async () => {
    const input = model('discrete'); input.nodes.splice(2, 0, node('delay', 'discrete.unit-delay', { initial: 0 })); input.edges = [edge('source', 'gain'), edge('gain', 'delay'), edge('delay', 'view')];
    const result = await runUncertaintyEnsemble(input, spec()); expect(result.status).toBe('completed');
    result.records.forEach((record) => expect(record.run!.result.samples.map((sample) => sample.values.view)).toEqual([0, ...Array(4).fill(3 * record.parameters[0]!.value)]));
    expect(result.statistics.points[0]!.mean).toBe(0); expect(result.statistics.points[0]!.standardDeviation).toBe(0);
  });
  it('continues validated failed partial runs, counts their resources and excludes them from statistics', async () => {
    let calls = 0; const budgets: SweepBudget[] = [];
    const result = await runUncertaintyEnsemble(model(), spec(), { execute: async (...args) => { budgets.push(args[1]); const actual = await execute(...args); calls += 1; if (calls % 2) throw new ModelError([{ code: 'EXPECTED_FAILURE', message: 'failure' }], { ...actual, status: 'failed' }); return actual; } });
    expect(result.status).toBe('failed'); expect(result.counts).toEqual({ requested: 4, attempted: 4, completed: 2, failed: 2, cancelled: 0, notStarted: 0 });
    expect(result.records.map((record) => record.status)).toEqual(['failed', 'completed', 'failed', 'completed']); expect(result.records[0]!.run!.result.status).toBe('failed');
    expect(result.statistics.status).toBe('completed'); expect(result.statistics.recordIds).toEqual(['sample2', 'sample4']); expect(result.statistics.points[0]!.count).toBe(2);
    expect(result.resources.recordedValues).toBe(8); expect(budgets.map((budget) => budget.maxRecordedValues)).toEqual([1_000_000, 999_998, 999_996, 999_994]);
  });
  it('reports a null sample standard deviation with one completed run and unavailable statistics with none', async () => {
    let calls = 0; const result = await runUncertaintyEnsemble(model(), spec(), { execute: async (...args) => ({ ...await execute(...args), status: ++calls === 2 ? 'completed' : 'failed' }) });
    expect(result.statistics.status).toBe('completed'); expect(result.statistics.points[0]!.count).toBe(1); expect(result.statistics.points[0]!.standardDeviation).toBeNull();
    const none = await runUncertaintyEnsemble(model(), spec(), { execute: async (...args) => ({ ...await execute(...args), status: 'failed' }) });
    expect(none.counts.failed).toBe(4); expect(none.statistics.status).toBe('unavailable'); expect(none.statistics.points).toEqual([]); expect(none.statistics.diagnostics[0]!.code).toBe('ENSEMBLE_NO_COMPLETED_RUNS');
  });
  it('preserves failed raw results from an actual domain error and continues later successes', async () => {
    const input = model(); input.nodes[1]!.blockType = 'math.sqrt'; input.nodes[1]!.parameters = {};
    const result = await runUncertaintyEnsemble(input, spec()); expect(result.counts.attempted).toBe(4); expect(result.counts.failed).toBe(2); expect(result.counts.completed).toBe(2); expect(result.status).toBe('failed');
    expect(result.statistics.points[0]!.mean).toBeCloseTo((Math.sqrt(result.records[2]!.parameters[0]!.value) + Math.sqrt(result.records[3]!.parameters[0]!.value)) / 2, 13);
  });
  it('refuses even a tiny grid difference admitted by raw-result roundoff validation', async () => {
    let calls = 0; const result = await runUncertaintyEnsemble(model('discrete'), spec(), { execute: async (...args) => { const actual = await execute(...args); if (++calls === 2) actual.samples[1]!.time += 1e-12; return actual; } });
    expect(result.counts.completed).toBe(4); expect(result.status).toBe('failed'); expect(result.statistics.status).toBe('failed'); expect(result.statistics.points).toEqual([]); expect(result.statistics.diagnostics[0]!.code).toBe('ENSEMBLE_STATISTICS_GRID');
  });
  it('uses scaled arithmetic to preserve huge finite equal means and rejects an overflowing standard deviation', async () => {
    const maximum = Number.MAX_VALUE;
    const equal = await runUncertaintyEnsemble(model(), spec(), { execute: async (...args) => { const actual = await execute(...args); actual.samples[0]!.values.view = maximum; return actual; } });
    expect(equal.statistics.status).toBe('completed'); expect(equal.statistics.points[0]!.mean).toBe(maximum); expect(equal.statistics.points[0]!.standardDeviation).toBe(0); expect(equal.statistics.points[0]!.median).toBe(maximum);
    let calls = 0; const spread = await runUncertaintyEnsemble(model(), spec(), { execute: async (...args) => { const actual = await execute(...args); actual.samples[0]!.values.view = ++calls % 2 ? -maximum : maximum; return actual; } });
    expect(spread.statistics.status).toBe('failed'); expect(spread.statistics.diagnostics[0]!.code).toBe('ENSEMBLE_STATISTICS_NONFINITE'); expect(spread.records.every((record) => record.run!.result.samples[0]!.values.view === maximum || record.run!.result.samples[0]!.values.view === -maximum)).toBe(true); expect(JSON.stringify(spread)).not.toMatch(/NaN|Infinity/);
  });
});

describe('M23 shared budgets and cancellation', () => {
  it.each(['operations', 'records'] as const)('keeps an exact shared %s budget and all not-started plans', async (kind) => {
    const result = await runUncertaintyEnsemble(model(), spec(), kind === 'operations' ? { maxOperations: 6 } : { maxRecordedValues: 4 });
    expect(result.status).toBe('failed'); expect(result.counts).toEqual({ requested: 4, attempted: 2, completed: 2, failed: 0, cancelled: 0, notStarted: 2 }); expect(result.records).toHaveLength(4);
    expect(result.diagnostics[0]!.code).toBe(kind === 'operations' ? 'ENSEMBLE_OPERATION_BUDGET' : 'ENSEMBLE_RECORD_BUDGET');
  });
  it('checks shared reported wall time and retains truthful completed records without a next candidate', async () => {
    let calls = 0; const result = await runUncertaintyEnsemble(model(), spec(), { maxWallMs: 100, execute: async (...args) => ({ ...await execute(...args), elapsedMs: ++calls * 60 }) });
    expect(calls).toBe(2); expect(result.status).toBe('failed'); expect(result.counts.notStarted).toBe(2); expect(result.resources.wallMs).toBeGreaterThanOrEqual(180); expect(result.diagnostics[0]!.code).toBe('ENSEMBLE_WALL_BUDGET');
  });
  it('times out an executor that never responds and stops all future samples', async () => {
    let calls = 0; const result = await runUncertaintyEnsemble(model(), spec(), { maxWallMs: 25, execute: async () => { calls += 1; return new Promise<RunResult>(() => {}); } });
    expect(calls).toBe(1); expect(result.status).toBe('failed'); expect(result.counts).toEqual({ requested: 4, attempted: 1, completed: 0, failed: 1, cancelled: 0, notStarted: 3 }); expect(result.diagnostics[0]!.code).toBe('ENSEMBLE_WALL_BUDGET');
  });
  it('cancels immediately despite an executor ignoring abort and never admits its late result or progress', async () => {
    const controller = new AbortController(); let resolve!: (value: RunResult) => void, calls = 0, updates = 0; const actual = await execute(model(), { maxWallMs: 1_000, maxOperations: 100, maxRecordedValues: 100, trackOperations: true });
    const pending = runUncertaintyEnsemble(model(), spec(), { signal: controller.signal, execute: async () => { calls += 1; return new Promise<RunResult>((done) => { resolve = done; controller.abort(); }); }, onProgress: () => { updates += 1; } });
    const result = await pending, snapshot = structuredClone(result); expect(result.status).toBe('cancelled'); expect(result.counts).toEqual({ requested: 4, attempted: 1, completed: 0, failed: 0, cancelled: 1, notStarted: 3 });
    resolve(actual); await Promise.resolve(); await Promise.resolve(); expect(result).toEqual(snapshot); expect(calls).toBe(1); expect(updates).toBe(0); expect(result.records[0]!.run).toBeUndefined();
  });
  it('rejects a completed response if the executor aborts before returning it', async () => {
    const controller = new AbortController(), result = await runUncertaintyEnsemble(model(), spec(), { signal: controller.signal, execute: async (...args) => { const actual = await execute(...args); controller.abort(); return actual; } });
    expect(result.status).toBe('cancelled'); expect(result.counts.completed).toBe(0); expect(result.records[0]!.run).toBeUndefined();
  });
  it('keeps a full reproducible unstarted plan on pre-abort and preserves completed records on between-run abort', async () => {
    const controller = new AbortController(); controller.abort(); let calls = 0;
    const pre = await runUncertaintyEnsemble(model(), spec(), { signal: controller.signal, execute: async (...args) => { calls += 1; return execute(...args); } });
    expect(pre.status).toBe('cancelled'); expect(pre.counts.attempted).toBe(0); expect(pre.counts.notStarted).toBe(4); expect(calls).toBe(0);
    const between = new AbortController(), updates: unknown[] = [], result = await runUncertaintyEnsemble(model(), spec(), { signal: between.signal, onProgress: (progress) => { updates.push(progress); between.abort(); } });
    expect(result.status).toBe('cancelled'); expect(result.counts.completed).toBe(1); expect(result.counts.notStarted).toBe(3); expect(updates).toEqual([{ completed: 1, total: 4, attempted: 1, failed: 0, cancelled: 0 }]); expect(result.records[0]!.run!.result.status).toBe('completed');
  });
  it('accounts for a validated returned cancelled partial and stops later runs', async () => {
    const result = await runUncertaintyEnsemble(model(), spec(), { execute: async (...args) => ({ ...await execute(...args), status: 'cancelled' }) });
    expect(result.status).toBe('cancelled'); expect(result.counts.cancelled).toBe(1); expect(result.counts.notStarted).toBe(3); expect(result.resources.operations).toBe(3); expect(result.resources.recordedValues).toBe(2); expect(result.records[0]!.run!.result.status).toBe('cancelled');
  });
  it.each(['unknown', 'missing-resource', 'invalid', 'zero-completed-operations'] as const)('conservatively terminates on an unaccounted or invalid result: %s', async (kind) => {
    let calls = 0; const result = await runUncertaintyEnsemble(model(), spec(), { execute: async (...args) => { calls += 1; const actual = await execute(...args); if (kind === 'unknown') throw new Error('no resource report'); if (kind === 'missing-resource') delete actual.resources; if (kind === 'invalid') actual.samples[0]!.values.view = NaN; if (kind === 'zero-completed-operations') actual.resources = { operations: 0 }; return actual; } });
    expect(calls).toBe(1); expect(result.status).toBe('failed'); expect(result.counts.failed).toBe(1); expect(result.counts.notStarted).toBe(3); expect(result.records[0]!.run).toBeUndefined(); expect(result.resources.operations).toBe(0);
  });
  it('does not allow a throwing progress callback to launch another candidate', async () => {
    let calls = 0; const result = await runUncertaintyEnsemble(model(), spec(), { execute: async (...args) => { calls += 1; return execute(...args); }, onProgress: () => { throw new Error('callback failure'); } });
    expect(calls).toBe(1); expect(result.status).toBe('failed'); expect(result.counts.completed).toBe(1); expect(result.counts.notStarted).toBe(3);
  });
});

describe('M23 bounded plain input and executor validation', () => {
  it.each(['seed-negative', 'seed-large', 'seed-fraction', 'seed-string', 'count-one', 'count-large', 'count-fraction', 'bounds-equal', 'bounds-reversed', 'bounds-nonfinite', 'bounds-large', 'kind', 'mode-low', 'mode-high', 'uniform-mode', 'missing-mode', 'target', 'duplicate', 'too-many', 'empty', 'unit', 'output', 'extra'] as const)('rejects invalid specifications before executing: %s', async (kind) => {
    const request = spec(); let calls = 0; const distribution = request.parameters[0]!.distribution;
    if (kind === 'seed-negative') request.seed = -1; if (kind === 'seed-large') request.seed = 2 ** 32; if (kind === 'seed-fraction') request.seed = 0.5; if (kind === 'seed-string') (request as unknown as { seed: unknown }).seed = '0';
    if (kind === 'count-one') request.sampleCount = 1; if (kind === 'count-large') request.sampleCount = 65; if (kind === 'count-fraction') request.sampleCount = 2.5;
    if (kind === 'bounds-equal') distribution.upper = distribution.lower; if (kind === 'bounds-reversed') distribution.lower = 10; if (kind === 'bounds-nonfinite') distribution.upper = Infinity; if (kind === 'bounds-large') distribution.upper = 1e13;
    if (kind === 'kind') (distribution as { kind: string }).kind = 'normal';
    if (kind === 'mode-low' || kind === 'mode-high') request.parameters[0]!.distribution = { kind: 'triangular', lower: -2, upper: 2, mode: kind === 'mode-low' ? -3 : 3 };
    if (kind === 'uniform-mode') Object.assign(distribution, { mode: 0 }); if (kind === 'missing-mode') (distribution as { kind: string }).kind = 'triangular';
    if (kind === 'target') request.parameters[0]!.nodeId = 'view'; if (kind === 'duplicate') request.parameters.push(structuredClone(request.parameters[0]!)); if (kind === 'too-many') request.parameters = Array(4).fill(request.parameters[0]); if (kind === 'empty') request.parameters = [];
    if (kind === 'unit') request.unit = 'm'; if (kind === 'output') request.outputId = 'gain'; if (kind === 'extra') Object.assign(request, { code: 'alert(1)' });
    await expect(runUncertaintyEnsemble(model(), request, { execute: async (...args) => { calls += 1; return execute(...args); } })).rejects.toBeInstanceOf(ModelError); expect(calls).toBe(0);
  });
  it.each([{ maxRuns: 65 }, { maxRuns: 0 }, { maxRuns: 3 }, { maxWallMs: 30_001 }, { maxWallMs: NaN }, { maxWallMs: 0 }, { maxRecordedValues: 1_000_001 }, { maxRecordedValues: 0 }, { maxOperations: 50_000_001 }, { maxOperations: 0 }, { maxOperations: 1.5 }, { signal: {} }, { execute: 1 }, { onProgress: 1 }, { extra: true }])('cannot raise hard limits or inject invalid options: %j', async (options) => { await expect(runUncertaintyEnsemble(model(), spec(), options as EnsembleOptions)).rejects.toBeInstanceOf(ModelError); });
  it.each(['spec', 'parameter', 'distribution', 'options', 'array', 'sparse', 'hidden', 'symbol'] as const)('rejects accessors, sparse arrays and hidden fields without invoking them: %s', async (kind) => {
    const request = spec(), options: EnsembleOptions = {}; let reads = 0; const getter = { enumerable: true, get: () => { reads += 1; return 2; } };
    if (kind === 'spec') Object.defineProperty(request, 'seed', getter); if (kind === 'parameter') Object.defineProperty(request.parameters[0], 'nodeId', getter); if (kind === 'distribution') Object.defineProperty(request.parameters[0]!.distribution, 'lower', getter); if (kind === 'options') Object.defineProperty(options, 'maxRuns', getter); if (kind === 'array') Object.defineProperty(request.parameters, '0', getter); if (kind === 'sparse') request.parameters = new Array(1); if (kind === 'hidden') Object.defineProperty(request, 'hidden', { value: 1 }); if (kind === 'symbol') Object.assign(request, { [Symbol('unsafe')]: 1 });
    await expect(runUncertaintyEnsemble(model(), request, options)).rejects.toBeInstanceOf(ModelError); expect(reads).toBe(0);
  });
  it.each([[1, 2], true, { kind: 'typed', dtype: 'float64', shape: [], data: [2] }])('does not coerce selected vector, boolean or typed output into scalar statistics: %j', async (value) => {
    const input = model(); input.nodes = [node('source', typeof value === 'object' && !Array.isArray(value) ? 'source.typed' : 'source.constant', { value }), node('coefficient', 'source.constant', { value: 1 }), node('view', 'sink.display')]; input.edges = [edge('source', 'view')]; const request = spec(); request.parameters[0]!.nodeId = 'coefficient';
    await rejects(() => runUncertaintyEnsemble(input, request), 'INVALID_ENSEMBLE_OUTPUT');
  });
  it('preflights all output elements and timestamps rather than just the selected scalar', async () => {
    const input = model('discrete'); input.execution.stopTime = 600; input.execution.step = 1; input.nodes.push(node('vector', 'source.constant', { value: Array(1_024).fill(1) }), node('vectorview', 'sink.scope')); input.edges.push(edge('vector', 'vectorview'));
    let calls = 0; await rejects(() => runUncertaintyEnsemble(input, { ...spec(), sampleCount: 2 }, { execute: async (...args) => { calls += 1; return execute(...args); } }), 'ENSEMBLE_RECORD_PREFLIGHT'); expect(calls).toBe(0);
  });
  it('preflights retained full-model snapshots before executing any candidate', async () => {
    const input = model(); for (let index = 0; index < 30; index += 1) input.nodes.push(node(`large${index}`, 'source.constant', { value: Array(1_024).fill(1.234567890123456e100) }));
    let calls = 0; await rejects(() => runUncertaintyEnsemble(input, { ...spec(), sampleCount: 64 }, { execute: async (...args) => { calls += 1; return execute(...args); } }), 'ENSEMBLE_SNAPSHOT_PREFLIGHT'); expect(calls).toBe(0); expect(ENSEMBLE_LIMITS.maxSnapshotBytes).toBe(32 * 1024 * 1024);
  });
  it('rejects hostile result and error getters without reading them', async () => {
    let reads = 0; const result = await runUncertaintyEnsemble(model(), spec(), { execute: async (...args) => { const actual = await execute(...args); Object.defineProperty(actual, 'samples', { enumerable: true, get: () => { reads += 1; return []; } }); return actual; } });
    expect(result.status).toBe('failed'); expect(result.diagnostics[0]!.code).toBe('SWEEP_RESOURCE_REPORT'); expect(reads).toBe(0);
    const error = new ModelError([{ code: 'initial', message: 'initial' }]); Object.defineProperty(error, 'diagnostics', { get: () => { reads += 1; return []; } }); Object.defineProperty(error, 'partialResult', { get: () => { reads += 1; return {}; } });
    const failure = await runUncertaintyEnsemble(model(), spec(), { execute: async () => { throw error; } }); expect(failure.status).toBe('failed'); expect(reads).toBe(0);
  });
  it('refuses other recorded typed sinks before execution even when the selected output is legacy scalar', async () => {
    const input = model(); input.nodes.push(node('typed', 'source.typed', { value: { kind: 'typed', dtype: 'float64', shape: [], data: [2] } }), node('typedview', 'sink.display')); input.edges.push(edge('typed', 'typedview'));
    let calls = 0; await rejects(() => runUncertaintyEnsemble(input, spec(), { execute: async (...args) => { calls += 1; return execute(...args); } }), 'ENSEMBLE_UNSUPPORTED_RECORDED_OUTPUT'); expect(calls).toBe(0);
  });
  it.each(['RUNTIME_WALL_BUDGET', 'RUNTIME_OPERATION_BUDGET', 'RUNTIME_RECORD_BUDGET', 'RUNTIME_EVALUATION_BUDGET', 'WORKER_CONTROL_TIMEOUT', 'M11_INVOCATION_LIMIT'])('stops after a validated partial resource limit instead of granting another candidate: %s', async (code) => {
    let calls = 0; const result = await runUncertaintyEnsemble(model(), spec(), { execute: async (...args) => { calls += 1; const actual = await execute(...args); throw new ModelError([{ code, message: 'bounded stop' }], { ...actual, status: 'failed' }); } });
    expect(calls).toBe(1); expect(result.counts.failed).toBe(1); expect(result.counts.notStarted).toBe(3); expect(result.resources.operations).toBe(3); expect(result.resources.recordedValues).toBe(2); expect(result.diagnostics[0]!.code).toBe(code);
  });
});
