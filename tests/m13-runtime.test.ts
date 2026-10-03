import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { ModelError, type DashboardAppliedEvent, type RunResult } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';
import { createDiscreteMachine } from '../packages/runtime/src/discrete-machine';
import { appendDashboardReplayEvents } from '../apps/web/src/dashboard-replay';
import { M13_INDEPENDENT_BOUNDARY_FIXTURES, M13_INDEPENDENT_DEFINITION_FIXTURES, M13_INDEPENDENT_FAILURE_FIXTURES, M13_LIVE_CONTROL_MODEL } from './m13-independent-fixtures';
function near(actual: unknown, expected: unknown, tolerance = 1e-12): void {
  if (typeof expected === 'number') { expect(typeof actual).toBe('number'); expect(Math.abs((actual as number) - expected) / Math.max(1, Math.abs(expected))).toBeLessThanOrEqual(tolerance); }
  else if (Array.isArray(expected)) { expect(Array.isArray(actual)).toBe(true); expect((actual as unknown[]).length).toBe(expected.length); expected.forEach((value, index) => near((actual as unknown[])[index], value, tolerance)); }
  else if (expected && typeof expected === 'object') { expect(Object.keys(actual as object).sort()).toEqual(Object.keys(expected).sort()); Object.entries(expected).forEach(([key, value]) => near((actual as Record<string, unknown>)[key], value, tolerance)); }
  else expect(actual).toEqual(expected);
}
describe('M13 actual compiled independent string, controls and recording contracts', () => {
  for (const fixture of [...M13_INDEPENDENT_DEFINITION_FIXTURES, ...M13_INDEPENDENT_BOUNDARY_FIXTURES]) for (const mode of fixture.declaredModes) it(`${fixture.name}/${mode}`, async () => {
    const model = structuredClone(fixture.model); model.execution.mode = mode; if (mode === 'static') model.execution.stopTime = model.execution.startTime;
    const compiled = compileModel(model), result = await runModel(compiled); expect(result.status).toBe('completed'); expect(Object.keys(fixture.expected).sort()).toEqual([...compiled.outputIds].sort());
    for (const [id, values] of Object.entries(fixture.expected)) { const series = mode === 'static' ? values.slice(0, 1) : values; expect(result.samples.length).toBe(series.length); series.forEach((value, index) => near(result.samples[index]!.values[id], value, fixture.oracleTolerance)); }
    if (mode !== 'static' && fixture.expectedFinalState) near(result.finalState, fixture.expectedFinalState);
    if (mode !== 'static' && fixture.expectedStateMemory) near(result.stateMemory, fixture.expectedStateMemory);
    expect(result.stopReason).toEqual(fixture.expectedStopReason);
  });
  for (const fixture of M13_INDEPENDENT_FAILURE_FIXTURES) it(`${fixture.name}/${fixture.code}`, async () => {
    let failure: ModelError | undefined; try { await runModel(compileModel(fixture.model)); } catch (error) { expect(error).toBeInstanceOf(ModelError); failure = error as ModelError; }
    expect(failure?.diagnostics[0]?.code).toBe(fixture.code);
    if (fixture.expectedPartial) { const partial = failure!.partialResult as RunResult; expect(partial.samples.length).toBe(fixture.expectedPartial.samples); if (fixture.expectedPartial.finalState) near(partial.finalState, fixture.expectedPartial.finalState); if (fixture.expectedPartial.stateMemory) near(partial.stateMemory, fixture.expectedPartial.stateMemory); }
  });
});
describe('M13 live control due-boundary replay and atomicity', () => {
  const control = { isPaused: () => false, waitForResume: async () => {} };
  it('applies FIFO changes at the next due tick, acknowledges physicaltime and reproduces the full replay result', async () => {
    const model = structuredClone(M13_LIVE_CONTROL_MODEL); model.nodes.forEach(node => { node.sampleTime = { period: 2, offset: 1 }; });
    const compiled = compileModel(model), receipts: DashboardAppliedEvent[] = []; let calls = 0;
    const result = await runModel(compiled, { control: { ...control, takeDashboardEvents: () => ++calls === 1 ? [{ nodeId: 'Control', value: .2 }, { nodeId: 'Control', value: .8 }] : [] }, onDashboardEventApplied: receipt => receipts.push(receipt) });
    expect(receipts).toEqual([{ nodeId: 'Control', time: .5, order: 1, value: .2 }, { nodeId: 'Control', time: .5, order: 2, value: .8 }]);
    expect(result.samples.map(sample => sample.values.Result)).toEqual([0, .8, .8]);
    const replay = structuredClone(model); replay.nodes[0]!.parameters.events = JSON.stringify([{ time: .5, order: 1, value: .2 }, { time: .5, order: 2, value: .8 }, { time: 1, order: 0, value: 1 }]);
    const rerun = await runModel(compileModel(replay)); const stable = (value: RunResult) => { const { elapsedMs, resources, ...rest } = value; return rest; }; expect(stable(result)).toEqual(stable(rerun)); expect(compiled.nodes.find(node => node.id === 'Control')!.parameters.events).toBe(model.nodes[0]!.parameters.events);
  });
  it('does not publish any control overlay if a second FIFO event is invalid', () => {
    const compiled = compileModel(M13_LIVE_CONTROL_MODEL), machine = createDiscreteMachine(compiled.nodes, compiled.stateIds, .5, 0, () => {}), before = machine.checkpoint();
    expect(() => machine.applyDashboardEvents([{ nodeId: 'Control', value: .2 }, { nodeId: 'Control', value: .35 }], 0, 0)).toThrow(ModelError); expect(machine.checkpoint()).toEqual(before);
  });
  it('rejects unknown targets, overfull queues and forbidden static/continuous live hooks', async () => {
    const compiled = compileModel(M13_LIVE_CONTROL_MODEL), machine = createDiscreteMachine(compiled.nodes, compiled.stateIds, .5, 0, () => {});
    expect(() => machine.applyDashboardEvents([{ nodeId: 'Result', value: .2 }], 0, 0)).toThrow(ModelError); expect(() => machine.applyDashboardEvents(Array.from({ length: 257 }, () => ({ nodeId: 'Control', value: .2 })), 0, 0)).toThrow(ModelError);
    for (const mode of ['static', 'continuous'] as const) { const model = structuredClone(M13_LIVE_CONTROL_MODEL); model.execution.mode = mode; await expect(runModel(compileModel(model), { control: { ...control, takeDashboardEvents: () => [] } })).rejects.toMatchObject({ diagnostics: [{ code: 'M13_LIVE_MODE_UNSUPPORTED' }] }); }
  });
  it('rejects accessors without invoking them and restores a live update when later recording fails', async () => {
    const compiled = compileModel(M13_LIVE_CONTROL_MODEL), machine = createDiscreteMachine(compiled.nodes, compiled.stateIds, .5, 0, () => {}); let touched = 0;
    const event = { nodeId: 'Control', get value() { touched++; return .2; } }; expect(() => machine.applyDashboardEvents([event], 0, 0)).toThrow(ModelError); expect(touched).toBe(0);
    const array = [{ nodeId: 'Control', value: .2 }]; Object.defineProperty(array, '0', { enumerable: true, get() { touched++; return event; } }); expect(() => machine.applyDashboardEvents(array, 0, 0)).toThrow(ModelError); expect(touched).toBe(0);
    const model = structuredClone(M13_LIVE_CONTROL_MODEL); model.nodes.push({ id: 'Record', blockType: 'sink.record', blockVersion: 1, label: 'Record', parameters: { capacity: 1 }, unit: '1' }); model.edges.push({ id: 'Control-record', source: { nodeId: 'Control', portId: 'out' }, target: { nodeId: 'Record', portId: 'in' } });
    let calls = 0; const receipts: DashboardAppliedEvent[] = []; let error: ModelError | undefined;
    try { await runModel(compileModel(model), { control: { ...control, takeDashboardEvents: () => [{ nodeId: 'Control', value: ++calls === 1 ? .2 : .8 }] }, onDashboardEventApplied: receipt => receipts.push(receipt) }); } catch (caught) { error = caught as ModelError; }
    expect(error?.diagnostics[0]?.code).toBe('M13_RECORD_CAPACITY'); const partial = error!.partialResult as RunResult; expect(partial.samples.map(sample => sample.values.Result)).toEqual([.2]); expect(partial.finalState).toEqual({ Record: .2 }); expect(partial.stateMemory).toEqual({ Record: { m13RecordTick: 0, m13Records: [{ time: 0, value: .2 }] } }); expect(receipts).toEqual([{ nodeId: 'Control', time: 0, order: 1, value: .2 }]);
  });
  it('deduplicates records within a repeated frame and rolls back copied trace on failed capacity', () => {
    const fixture = M13_INDEPENDENT_DEFINITION_FIXTURES.find(entry => entry.model.nodes.some(node => node.blockType === 'sink.record'))!, compiled = compileModel(fixture.model), machine = createDiscreteMachine(compiled.nodes, compiled.stateIds, .5, 0, () => {});
    const values = machine.evaluate(0, 0); machine.evaluate(0, 0, values); expect((machine.stateMemory()!.Block as { m13Records: unknown[] }).m13Records).toHaveLength(1);
  });
  for (const failure of ['budget', 'getter', 'throw'] as const) it(`retains the entire previous boundary on midrun ${failure} live-queue failure`, async () => {
    const model = structuredClone(M13_LIVE_CONTROL_MODEL); model.nodes.push({ id: 'Delay', blockType: 'discrete.unit-delay', blockVersion: 1, label: 'Delay', parameters: { initial: -1 }, unit: '1' }); model.edges.push({ id: 'Control-delay', source: { nodeId: 'Control', portId: 'out' }, target: { nodeId: 'Delay', portId: 'in' } });
    let calls = 0, touched = 0, error: ModelError | undefined;
    try { await runModel(compileModel(model), { control: { ...control, takeDashboardEvents: () => { if (++calls === 1) return []; if (failure === 'throw') throw new Error('private source details'); if (failure === 'budget') return Array.from({ length: 33 }, () => ({ nodeId: 'Control', value: .2 })); const values = [{ nodeId: 'Control', value: .2 }]; Object.defineProperty(values, '0', { enumerable: true, get() { touched++; return { nodeId: 'Control', value: .2 }; } }); return values; } } }); } catch (caught) { error = caught as ModelError; }
    expect(error?.diagnostics[0]?.code).toBe(failure === 'throw' ? 'M13_LIVE_EVENT_SOURCE' : failure === 'getter' ? 'M13_LIVE_EVENT_SHAPE' : 'M13_LIVE_EVENT_BUDGET'); expect(touched).toBe(0); const partial = error!.partialResult as RunResult; expect(partial.samples).toEqual([{ time: 0, values: { Control: 0, Result: 0 } }]); expect(partial.finalState).toEqual({ Delay: -1 });
  });
  it('owns nonzero source initial publication before an offset control is due', async () => {
    const model = structuredClone(M13_LIVE_CONTROL_MODEL); model.nodes.forEach(node => { node.sampleTime = { period: 2, offset: 1 }; }); model.nodes[0]!.parameters.initial = .4;
    const result = await runModel(compileModel(model)); expect(result.samples.map(sample => sample.values.Control)).toEqual([.4, .4, .4]);
  });
  it('canonicalizes JSON control negative zero before publication and receipt so replay preserves typed string output', async () => {
    const model = structuredClone(M13_LIVE_CONTROL_MODEL); model.execution.stopTime = 0; model.nodes[0]!.parameters = { min: -1, max: 1, step: 1, initial: -0, events: '[{"time":0,"order":0,"value":-0}]' }; model.nodes.push({ id: 'String', blockType: 'string.to-string', blockVersion: 1, label: 'String', parameters: {}, unit: '1' }); model.edges = [{ id: 'Control-String', source: { nodeId: 'Control', portId: 'out' }, target: { nodeId: 'String', portId: 'in' } }, { id: 'String-Result', source: { nodeId: 'String', portId: 'out' }, target: { nodeId: 'Result', portId: 'in' } }];
    const compiled = compileModel(model), receipts: DashboardAppliedEvent[] = [], result = await runModel(compiled, { control: { ...control, takeDashboardEvents: () => [{ nodeId: 'Control', value: -0 }] }, onDashboardEventApplied: receipt => receipts.push(receipt) });
    expect(Object.is(receipts[0]!.value, 0)).toBe(true); expect(Object.is(result.samples[0]!.values.Control, 0)).toBe(true); expect(result.samples[0]!.values.Result).toEqual({ kind: 'typed', dtype: 'string', shape: [], data: ['0'] });
    const replay = await runModel(compileModel(appendDashboardReplayEvents(compiled.model, receipts))); const stable = (value: RunResult) => { const { elapsedMs, resources, ...rest } = value; return rest; }; expect(stable(result)).toEqual(stable(replay));
    const offset = structuredClone(model); offset.execution.stopTime = 1; offset.nodes[0]!.parameters.events = '[]'; offset.nodes.forEach(node => { node.sampleTime = { period: 2, offset: 1 }; }); const held = await runModel(compileModel(offset)); expect(Object.is(held.samples[0]!.values.Control, 0)).toBe(true);
  });
});
