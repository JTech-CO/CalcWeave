import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { createSubsystemFromSelection } from '../packages/compiler/src/hierarchy';
import { importDataset } from '../packages/data/src';
import { compareRuns, runParameterSweep, type SweepBudget, type SweepOptions, type SweepRecord, type SweepSpec } from '../packages/experiments/src';
import { ModelError, type CalcEdge, type CalcModel, type CalcNode, type RunResult } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';

const node = (id: string, blockType: string, parameters: Record<string, unknown> = {}): CalcNode => ({ id, blockType, blockVersion: 1, label: id, parameters });
const edge = (source: string, target: string): CalcEdge => ({ id: `${source}-${target}`, source: { nodeId: source, portId: 'out' }, target: { nodeId: target, portId: 'in' } });
const graph = (): CalcModel => ({ schemaVersion: 1, modelId: 'sweep', name: 'Sweep', nodes: [node('source', 'source.constant', { value: 2 }), node('gain', 'math.gain', { gain: 1 }), node('view', 'sink.display')], edges: [edge('source', 'gain'), edge('gain', 'view')], execution: { mode: 'static', startTime: 0, stopTime: 1, step: 0.1 }, layout: {} });
const spec = (): SweepSpec => ({ nodeId: 'gain', parameter: 'gain', values: [1, 2, 3] });
const actualExecute = (model: CalcModel, budget: SweepBudget): Promise<RunResult> => runModel(compileModel(model), budget);
const code = async (action: () => Promise<unknown>, expected: string): Promise<void> => {
  try { await action(); throw new Error(`Expected ${expected}`); }
  catch (error) { expect(error).toBeInstanceOf(ModelError); expect((error as ModelError).diagnostics.some((item) => item.code === expected)).toBe(true); }
};

describe('M4 sequential scalar parameter experiments', () => {
  it('runs known gains, keeps originals immutable and captures exact reproducible model/manifest hashes', async () => {
    const model = graph(), original = JSON.stringify(model);
    const sweep = await runParameterSweep(model, spec());
    expect(sweep.status).toBe('completed'); expect(sweep.records.map((record) => record.result.samples[0]!.values.view)).toEqual([2, 4, 6]);
    expect(sweep.records.map((record) => record.result.status)).toEqual(['completed', 'completed', 'completed']);
    expect(JSON.stringify(model)).toBe(original);
    for (const record of sweep.records) {
      const compiled = compileModel(record.model), hash = createHash('sha256').update(compiled.semanticKey).digest('hex');
      expect(record.modelHash).toBe(hash); expect(record.manifest.modelHash).toBe(hash);
      expect(record.result.resources!.operations).toBe(3);
      expect((await runModel(compiled)).samples).toEqual(record.result.samples);
    }
    const repeat = await runParameterSweep(model, spec());
    expect(repeat.records.map((record) => record.modelHash)).toEqual(sweep.records.map((record) => record.modelHash));
    sweep.records[0]!.model.nodes[0]!.parameters.value = 123; sweep.records[0]!.result.samples[0]!.values.view = 123;
    expect(model.nodes[0]!.parameters.value).toBe(2); expect(sweep.records[1]!.model.nodes[0]!.parameters.value).toBe(2);
  });

  it.each(['source.constant', 'io.input'])('allows only scalar value parameters on %s', async (type) => {
    const model = graph(); model.nodes[0]!.blockType = type;
    const sweep = await runParameterSweep(model, { nodeId: 'source', parameter: 'value', values: [1, 2, 3] });
    expect(sweep.records.map((record) => record.result.samples[0]!.values.view)).toEqual([1, 2, 3]);
  });

  it('validates every model variant before the first executor invocation', async () => {
    const model = graph(); model.dashboard = [{ id: 'gainControl', kind: 'slider', title: '배율', nodeId: 'gain', parameter: 'gain', min: 0, max: 3, step: 1 }];
    let calls = 0;
    await code(() => runParameterSweep(model, { ...spec(), values: [1, 2, 4] }, { execute: async (...args) => { calls += 1; return actualExecute(...args); } }), 'INVALID_DASHBOARD_BINDING');
    expect(calls).toBe(0);
  });

  it('captures dataset and reusable hierarchy references in every experiment manifest', async () => {
    const model = graph(); model.nodes[0] = node('source', 'source.dataset', { datasetId: 'data', column: 'value', interpolation: 'linear', outside: 'hold' });
    model.datasets = [importDataset('time,value\n0,2\n1,4\n', { id: 'data', name: '자료', format: 'csv', timeColumn: 'time', columns: [{ name: 'time', kind: 'number', unit: 's' }, { name: 'value', kind: 'number', unit: '1' }] })];
    const grouped = createSubsystemFromSelection(model, ['gain']);
    const sweep = await runParameterSweep(grouped, { nodeId: 'source', parameter: 'value', values: [1] }).catch((error) => error);
    expect(sweep).toBeInstanceOf(ModelError); // Playback references cannot be rewritten as scalar values.
    const dataSweep = await runParameterSweep(model, spec());
    expect(dataSweep.records[0]!.manifest.dataReferences[0]?.contentHash).toBe(model.datasets[0]!.contentHash);
    expect(dataSweep.records[0]!.model.datasets?.[0]?.rows).toEqual(model.datasets[0]!.rows);
    const scalarGrouped = createSubsystemFromSelection(graph(), ['gain']);
    const hierarchySweep = await runParameterSweep(scalarGrouped, { nodeId: 'source', parameter: 'value', values: [1, 2] });
    expect(hierarchySweep.records[0]!.manifest.hierarchyReferences).toHaveLength(1);
    expect(hierarchySweep.records[0]!.manifest.hierarchyReferences).toEqual(hierarchySweep.records[1]!.manifest.hierarchyReferences);
  });

  it('provides defensive progress snapshots and immutable executor arguments', async () => {
    const model = graph(); const progress: number[] = [];
    const sweep = await runParameterSweep(model, spec(), {
      execute: async (snapshot, budget) => { expect(Object.isFrozen(snapshot.nodes[0]!.parameters)).toBe(true); expect(Object.isFrozen(budget)).toBe(true); return actualExecute(snapshot, budget); },
      onProgress: (update) => { progress.push(update.completed); update.records[0]!.model.nodes[0]!.parameters.value = 99; update.records[0]!.result.samples[0]!.values.view = 99; },
    });
    expect(progress).toEqual([1, 2, 3]); expect(sweep.records.map((record) => record.result.samples[0]!.values.view)).toEqual([2, 4, 6]);
  });

  it('accepts harmless shared output arrays while cloning them away from the executor', async () => {
    const model = graph(); model.nodes[0]!.parameters.value = [2, 4]; model.nodes.push(node('trace', 'sink.display')); model.edges.push(edge('gain', 'trace'));
    let executorResult: RunResult | undefined;
    const sweep = await runParameterSweep(model, { ...spec(), values: [1] }, { execute: async (...args) => {
      executorResult = await actualExecute(...args); executorResult.samples[0]!.values.trace = executorResult.samples[0]!.values.view; return executorResult;
    } });
    expect(sweep.status).toBe('completed'); expect(sweep.records[0]!.result.samples[0]!.values.trace).toEqual([2, 4]);
    (executorResult!.samples[0]!.values.view as number[])[0] = 99;
    expect(sweep.records[0]!.result.samples[0]!.values.view).toEqual([2, 4]);
  });

  it('accounts typed vector outputs and records continuous solver snapshots', async () => {
    const vector = graph(); vector.nodes[0]!.parameters.value = [2, 4];
    const vectorSweep = await runParameterSweep(vector, spec(), { maxRecordedValues: 6 });
    expect(vectorSweep.records.map((record) => record.result.samples[0]!.values.view)).toEqual([[2, 4], [4, 8]]);
    expect(vectorSweep.status).toBe('failed'); expect(compareRuns(vectorSweep.records).diagnostics![0]!.code).toBe('SWEEP_COMPARE_OUTPUT');
    const continuous = graph(); continuous.execution = { mode: 'continuous', startTime: 0, stopTime: 0.2, step: 0.1 };
    continuous.nodes.splice(2, 0, node('state', 'continuous.integrator', { initial: 0 })); continuous.edges = [edge('source', 'gain'), edge('gain', 'state'), edge('state', 'view')];
    const continuousSweep = await runParameterSweep(continuous, spec()); expect(continuousSweep.status).toBe('completed');
    continuousSweep.records.forEach((record) => { expect(record.result.samples.at(-1)!.values.view).toBeCloseTo(record.value * 0.4, 13); expect(record.result.resources!.operations).toBeGreaterThan(0); });
  });
});

describe('M4 sweep validation and shared resource enforcement', () => {
  it.each([
    { nodeId: 'missing', parameter: 'gain', values: [1] },
    { nodeId: 'gain', parameter: 'other', values: [1] },
    { nodeId: 'view', parameter: 'value', values: [1] },
  ])('rejects unsupported scalar targets %j', async (invalid) => { await code(() => runParameterSweep(graph(), invalid), 'INVALID_SWEEP_TARGET'); });

  it('rejects boolean/vector targets and rejects values exceeding the configured run limit', async () => {
    for (const value of [true, [1, 2]]) {
      const model = graph(); model.nodes = [node('source', 'source.constant', { value }), node('view', 'sink.display')]; model.edges = [edge('source', 'view')];
      await code(() => runParameterSweep(model, { nodeId: 'source', parameter: 'value', values: [1] }), 'INVALID_SWEEP_TARGET');
    }
    await code(() => runParameterSweep(graph(), spec(), { maxRuns: 2 }), 'INVALID_SWEEP');
  });

  it.each([[], [Number.NaN], [Number.POSITIVE_INFINITY], Array.from({ length: 17 }, (_, index) => index)].map((values) => ({ values })))('rejects invalid repeated values %j', async ({ values }) => { await code(() => runParameterSweep(graph(), { ...spec(), values }), 'INVALID_SWEEP'); });
  it.each([{ maxRuns: 17 }, { maxRuns: 0 }, { maxWallMs: 0 }, { maxWallMs: 30_001 }, { maxRecordedValues: 1.5 }, { maxRecordedValues: 1_000_001 }, { maxOperations: 50_000_001 }, { maxOperations: 0 }, { unexpected: true }])('rejects unsupported options %j', async (options) => { await code(() => runParameterSweep(graph(), spec(), options as SweepOptions), 'INVALID_SWEEP_OPTIONS'); });

  it('rejects getters, holes and hidden option keys before invoking any accessor', async () => {
    let accessed = false;
    const options = {}; Object.defineProperty(options, 'maxRuns', { enumerable: true, get: () => { accessed = true; return 1; } });
    await code(() => runParameterSweep(graph(), spec(), options), 'INVALID_SWEEP_OPTIONS'); expect(accessed).toBe(false);
    const values = [1]; Object.defineProperty(values, '0', { enumerable: true, get: () => { accessed = true; return 1; } });
    await code(() => runParameterSweep(graph(), { ...spec(), values }), 'INVALID_SWEEP'); expect(accessed).toBe(false);
    await code(() => runParameterSweep(graph(), { ...spec(), values: new Array<number>(1) }), 'INVALID_SWEEP');
  });

  it('subtracts timestamps and outputs from one recording budget across all runs', async () => {
    const budgets: number[] = [];
    const sweep = await runParameterSweep(graph(), spec(), { maxRecordedValues: 4, execute: (model, budget) => { budgets.push(budget.maxRecordedValues); return actualExecute(model, budget); } });
    expect(budgets).toEqual([4, 2]); expect(sweep.status).toBe('failed'); expect(sweep.records).toHaveLength(2); expect(sweep.diagnostics![0]!.code).toBe('SWEEP_RECORD_BUDGET');
    const partial = await runParameterSweep(graph(), spec(), { maxRecordedValues: 3 });
    expect(partial.records).toHaveLength(1); expect(partial.diagnostics![0]!.code).toBe('RUNTIME_RECORD_BUDGET');
  });

  it('rejects sink-free models before execution so they cannot evade the recording budget', async () => {
    const model = graph(); model.nodes.pop(); model.edges.pop();
    let calls = 0;
    await code(() => runParameterSweep(model, spec(), { maxRecordedValues: 2, execute: (...args) => { calls += 1; return actualExecute(...args); } }), 'OUTPUT_REQUIRED');
    expect(calls).toBe(0);
  });

  it('subtracts actual operation usage from one computation budget across all runs', async () => {
    const budgets: number[] = [];
    const sweep = await runParameterSweep(graph(), spec(), { maxOperations: 6, execute: (model, budget) => { budgets.push(budget.maxOperations); return actualExecute(model, budget); } });
    expect(budgets).toEqual([6, 3]); expect(sweep.status).toBe('failed'); expect(sweep.records).toHaveLength(2); expect(sweep.diagnostics![0]!.code).toBe('SWEEP_OPERATION_BUDGET');
    const partial = await runParameterSweep(graph(), spec(), { maxOperations: 5 });
    expect(partial.records).toHaveLength(1); expect(partial.diagnostics![0]!.code).toBe('RUNTIME_OPERATION_BUDGET');
  });

  it('consumes reported active time and stops when an executor ignores the deadline', async () => {
    const reported = await runParameterSweep(graph(), spec(), { maxWallMs: 100, execute: async (model, budget) => ({ ...await actualExecute(model, budget), elapsedMs: 110 }) });
    expect(reported.status).toBe('failed'); expect(reported.records).toHaveLength(1); expect(reported.diagnostics![0]!.code).toBe('SWEEP_WALL_BUDGET');
    const timeout = await runParameterSweep(graph(), spec(), { maxWallMs: 40, execute: async () => new Promise<RunResult>(() => {}) });
    expect(timeout.status).toBe('failed'); expect(timeout.records).toEqual([]); expect(timeout.diagnostics![0]!.code).toBe('SWEEP_WALL_BUDGET');
  });

  it('stops before another run on cancellation, including an already-aborted request', async () => {
    const controller = new AbortController(); let calls = 0;
    const sweep = await runParameterSweep(graph(), spec(), { signal: controller.signal, execute: (...args) => { calls += 1; return actualExecute(...args); }, onProgress: () => { controller.abort(); } });
    expect(sweep.status).toBe('cancelled'); expect(sweep.records).toHaveLength(1); expect(calls).toBe(1);
    const before = await runParameterSweep(graph(), spec(), { signal: controller.signal }); expect(before).toEqual({ status: 'cancelled', records: [] });
  });

  it('preserves a returned cancellation snapshot and an error partial snapshot with their truthful statuses', async () => {
    const cancelled = await runParameterSweep(graph(), spec(), { execute: async (...args) => ({ ...await actualExecute(...args), status: 'cancelled' }) });
    expect(cancelled.status).toBe('cancelled'); expect(cancelled.records[0]!.result.status).toBe('cancelled'); expect(cancelled.records).toHaveLength(1);
    const failed = await runParameterSweep(graph(), spec(), { execute: async (...args) => { const result = await actualExecute(...args); throw new ModelError([{ code: 'NUMERIC_TEST', message: '실패 표본' }], { ...result, status: 'failed' }); } });
    expect(failed.status).toBe('failed'); expect(failed.records[0]!.result.status).toBe('failed'); expect(failed.diagnostics![0]!.code).toBe('NUMERIC_TEST');
  });

  it.each(['missing', 'negative', 'zero', 'excess', 'steps', 'time', 'shape', 'nonfinite', 'accessor'])('rejects dishonest or malformed executor resource reports: %s', async (mode) => {
    let accessed = false;
    const sweep = await runParameterSweep(graph(), { ...spec(), values: [1] }, { execute: async (model, budget) => {
      const result = await actualExecute(model, budget);
      if (mode === 'missing') delete result.resources;
      if (mode === 'negative') result.resources!.operations = -1;
      if (mode === 'zero') result.resources!.operations = 0;
      if (mode === 'excess') result.resources!.operations = budget.maxOperations + 1;
      if (mode === 'steps') result.steps += 1;
      if (mode === 'time') result.samples[0]!.time = 7;
      if (mode === 'shape') result.samples[0]!.values.view = [2, 3];
      if (mode === 'nonfinite') result.samples[0]!.values.view = Number.NaN;
      if (mode === 'accessor') Object.defineProperty(result.resources, 'operations', { enumerable: true, get: () => { accessed = true; return 3; } });
      return result;
    } });
    expect(sweep.status).toBe('failed'); expect(sweep.records).toEqual([]); expect(sweep.diagnostics![0]!.code).toBe('SWEEP_RESOURCE_REPORT'); expect(accessed).toBe(false);
  });
});

describe('M4 comparable scalar run summaries', () => {
  it('reports final values, deltas and RMSE for three identical time grids', async () => {
    const model = graph(); model.execution = { mode: 'discrete', startTime: 0, stopTime: 0.2, step: 0.1 };
    const sweep = await runParameterSweep(model, spec()); const comparison = compareRuns(sweep.records);
    expect(comparison).toEqual({ status: 'completed', referenceId: 'run1', outputs: [{ nodeId: 'view', unit: '1', values: [{ recordId: 'run1', status: 'completed', finalValue: 2, delta: 0, rmse: 0 }, { recordId: 'run2', status: 'completed', finalValue: 4, delta: 2, rmse: 2 }, { recordId: 'run3', status: 'completed', finalValue: 6, delta: 4, rmse: 4 }] }] });
  });

  it('rejects different time grids or units and avoids implicit resampling', async () => {
    const sweep = await runParameterSweep(graph(), spec()); const records = structuredClone(sweep.records);
    records[1]!.result.samples[0]!.time += 0.01; expect(compareRuns(records).diagnostics![0]!.code).toBe('SWEEP_COMPARE_GRID');
    records[1]!.result.samples[0]!.time -= 0.01; records[1]!.manifest.outputTypes.view!.unit = 'm'; expect(compareRuns(records).diagnostics![0]!.code).toBe('SWEEP_COMPARE_UNIT');
    expect(compareRuns([]).diagnostics![0]!.code).toBe('SWEEP_COMPARE_COUNT'); expect(compareRuns([...records, records[0]!]).diagnostics![0]!.code).toBe('SWEEP_COMPARE_COUNT');
    expect(compareRuns([{ ...records[0]!, result: { ...records[0]!.result, samples: [] } }]).diagnostics![0]!.code).toBe('SWEEP_COMPARE_EMPTY');
  });

  it('scales RMSE to avoid squaring overflow and diagnoses an unrepresentable difference', async () => {
    const sweep = await runParameterSweep(graph(), { ...spec(), values: [1, 2] }); const records: SweepRecord[] = structuredClone(sweep.records);
    records[0]!.result.samples[0]!.values.view = 0; records[1]!.result.samples[0]!.values.view = 1e300;
    expect(compareRuns(records).outputs[0]!.values[1]!.rmse).toBe(1e300);
    records[0]!.result.samples[0]!.values.view = -1e308; records[1]!.result.samples[0]!.values.view = 1e308;
    expect(compareRuns(records).diagnostics![0]!.code).toBe('SWEEP_COMPARE_NONFINITE');
  });
});
