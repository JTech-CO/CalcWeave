import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { createExportManifest } from '../packages/codegen-ts/src';
import { ModelError, type CalcModel, type DashboardAppliedEvent } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';

function model(period = 1): CalcModel {
  return { schemaVersion: 1, modelId: 'Live', name: 'Live', nodes: [
    { id: 'Control', blockType: 'dashboard.control', blockVersion: 1, label: 'Control', parameters: { initial: 1, min: 0, max: 10, step: 1 }, sampleTime: { period, offset: 0 }, unit: '1' },
    { id: 'Result', blockType: 'sink.scope', blockVersion: 1, label: 'Result', parameters: {}, sampleTime: { period, offset: 0 }, unit: '1' },
  ], edges: [{ id: 'Wire', source: { nodeId: 'Control', portId: 'out' }, target: { nodeId: 'Result', portId: 'in' } }], layout: {}, execution: { mode: 'discrete', startTime: 0, stopTime: 4, step: 1 } };
}
const stable = (result: Awaited<ReturnType<typeof runModel>>) => { const { elapsedMs: _elapsed, resources: _resources, ...semantic } = result; return semantic; };
const controls = (takeDashboardEvents: () => { nodeId: string; value: number }[]) => ({ isPaused: () => false, waitForResume: async () => {}, takeDashboardEvents });

describe('M13 live discrete publication and deterministic replay', () => {
  it('queues until the actual multirate due, preserves FIFO and leaves compiled IR immutable', async () => {
    const original = model(2), compiled = compileModel(original), before = JSON.stringify(compiled), receipts: DashboardAppliedEvent[] = [];
    let tick = 0;
    const result = await runModel(compiled, { control: controls(() => { const index = tick++; return index === 1 ? [{ nodeId: 'Control', value: 3 }] : index === 2 ? [{ nodeId: 'Control', value: 5 }] : []; }), onDashboardEventApplied: item => receipts.push(item) });
    expect(result.samples.map(sample => sample.values.Result)).toEqual([1, 1, 5, 5, 5]);
    expect(receipts).toEqual([{ nodeId: 'Control', value: 3, time: 2, order: 0 }, { nodeId: 'Control', value: 5, time: 2, order: 1 }]);
    expect(JSON.stringify(compiled)).toBe(before);
    const replay = structuredClone(original); replay.nodes[0]!.parameters.events = JSON.stringify(receipts.map(({ nodeId: _id, ...event }) => event));
    expect(stable(await runModel(compileModel(replay)))).toEqual(stable(result));
    expect((await createExportManifest(compileModel(replay))).modelHash).not.toBe((await createExportManifest(compiled)).modelHash);
  });
  it('rolls back the entire failed observation and never acknowledges its input', async () => {
    const value = model(); value.nodes.push(
      { id: 'Large', blockType: 'source.constant', blockVersion: 1, label: 'Large', parameters: { value: 1e308 }, unit: '1' },
      { id: 'Multiply', blockType: 'math.multiply', blockVersion: 1, label: 'Multiply', parameters: {}, unit: '1' });
    value.edges[0]!.source.nodeId = 'Multiply'; value.edges.push(
      { id: 'A', source: { nodeId: 'Control', portId: 'out' }, target: { nodeId: 'Multiply', portId: 'a' } },
      { id: 'B', source: { nodeId: 'Large', portId: 'out' }, target: { nodeId: 'Multiply', portId: 'b' } });
    const applied: DashboardAppliedEvent[] = []; let tick = 0;
    try { await runModel(compileModel(value), { control: controls(() => tick++ === 1 ? [{ nodeId: 'Control', value: 2 }] : []), onDashboardEventApplied: event => applied.push(event) }); throw new Error('Expected overflow'); }
    catch (error) { expect(error).toBeInstanceOf(ModelError); const failure = error as ModelError; expect(failure.diagnostics[0]?.code).toBe('NUMERIC_NONFINITE'); expect(failure.partialResult?.samples).toHaveLength(1); expect(failure.partialResult?.samples[0]?.values.Result).toBe(1e308); }
    expect(applied).toEqual([]);
  });
  it('validates the whole incoming batch before applying any event', async () => {
    const receipts: DashboardAppliedEvent[] = [];
    await expect(runModel(compileModel(model()), { control: controls(() => [{ nodeId: 'Control', value: 2 }, { nodeId: 'Missing', value: 3 }]), onDashboardEventApplied: event => receipts.push(event) })).rejects.toMatchObject({ partialResult: { steps: 0 } });
    expect(receipts).toEqual([]);
  });
  it('bounds the IPC drain before any sample can publish', async () => {
    await expect(runModel(compileModel(model()), { control: controls(() => Array.from({ length: 33 }, () => ({ nodeId: 'Control', value: 2 }))) })).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: 'M13_LIVE_EVENT_BUDGET' })], partialResult: { steps: 0 } });
  });
  it.each(['static', 'continuous'] as const)('rejects live hooks explicitly in %s mode', async mode => {
    const value = model(); value.execution.mode = mode; if (mode === 'static') value.execution.stopTime = 0;
    await expect(runModel(compileModel(value), { control: controls(() => []) })).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: 'M13_LIVE_MODE_UNSUPPORTED' })] });
  });
});
