import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { ModelError, type SignalValue } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';
import { createDiscreteMachine } from '../packages/runtime/src/discrete-machine';
import { M9_BLOCK_IDS } from '../packages/block-library/src/m9';
import { M9_FIXTURES, M9_FAILURE_FIXTURES, M9_PRESET_FIXTURES, m9Model, m9RollbackModel } from './m9-fixtures';

function close(actual: SignalValue, expected: SignalValue): void {
  if (typeof expected === 'number') { expect(typeof actual).toBe('number'); expect(Number.isFinite(actual)).toBe(true); if (expected !== 0 && Math.abs(expected) < 2 ** -1022) expect(actual).toBe(expected); else expect(Math.abs((actual as number) - expected) / Math.max(1, Math.abs(expected))).toBeLessThanOrEqual(3e-12); }
  else if (typeof expected === 'boolean') expect(actual).toBe(expected);
  else { expect(Array.isArray(actual)).toBe(true); expect((actual as unknown[]).length).toBe(expected.length); expected.forEach((value, i) => close((actual as SignalValue[])[i]!, value)); }
}
describe('M9 independent series and immutable state', () => {
  it.each(M9_FIXTURES)('$name', async entry => {
    const compiled = compileModel(entry.model), run = await runModel(compiled);
    for (const [id, expected] of Object.entries(entry.expected)) { expect(run.samples).toHaveLength(expected.length); expected.forEach((value, index) => close(run.samples[index]!.values[id]!, value)); }
    if (entry.expectedMemory) expect(run.stateMemory).toMatchObject(entry.expectedMemory);
    const reversed = structuredClone(entry.model); reversed.nodes.reverse(); reversed.edges.reverse();
    const reordered = await runModel(compileModel(reversed));
    expect(reordered.samples).toEqual(run.samples); expect(reordered.finalState).toEqual(run.finalState); expect(reordered.stateMemory).toEqual(run.stateMemory);
  });
  it.each(M9_FAILURE_FIXTURES)('rejects $name with the original node and tick', async entry => {
    try { await runModel(compileModel(entry.model)); throw new Error('Expected runtime rejection'); }
    catch (error) { expect(error).toBeInstanceOf(ModelError); expect((error as ModelError).diagnostics).toContainEqual(expect.objectContaining({ code: entry.code, ...(entry.nodeId ? { nodeId: entry.nodeId } : {}), ...(entry.tick !== undefined ? { tick: entry.tick } : {}), ...(entry.time !== undefined ? { time: entry.time } : {}) })); }
  });
  it.each(M9_PRESET_FIXTURES)('runs preset $presetId', async entry => { const run = await runModel(compileModel(entry.model)); for (const [id, expected] of Object.entries(entry.expected)) expected.forEach((value, i) => close(run.samples[i]!.values[id]!, value)); });
  it('publishes one RNG draw per tick across whole/node/repeat evaluation and rollback', () => {
    const compiled = compileModel(m9Model('source.band-limited-noise', { seed: 1 }, {}, { steps: 3 }));
    const operation = compiled.nodes.find(node => node.id === 'operation')!;
    const machine = createDiscreteMachine(compiled.nodes, compiled.stateIds, 1, 0, () => {});
    const checkpoint = machine.checkpoint(), first = machine.evaluate(0, 0), memory = machine.stateMemory(true);
    expect(machine.evaluate(0, 0, undefined, true).get('operation')).toEqual(first.get('operation'));
    expect(machine.evaluateNode(operation, 0, 0, () => { throw new Error('Unexpected noise input'); })).toEqual(first.get('operation'));
    expect(machine.stateMemory(true)).toEqual(memory);
    machine.restore(checkpoint); expect(machine.evaluate(0, 0).get('operation')).toEqual(first.get('operation'));
  });
  it('rolls back a pending RNG draw and state transition when the last assertion fails', async () => {
    try { await runModel(compileModel(m9RollbackModel())); throw new Error('Expected assertion failure'); }
    catch (error) {
      expect(error).toBeInstanceOf(ModelError); const partial = (error as ModelError).partialResult!;
      expect(partial.samples).toHaveLength(2); close(partial.samples[0]!.values.result!, -1.1568343541568942); close(partial.samples[1]!.values.result!, -.3273030939168647);
      expect(partial.stateMemory!.operation).toMatchObject({ seed: 3027450565, previousOutput: -.3273030939168647 });
      expect(partial.finalState.operation).toBe(-.3273030939168647);
    }
  });
  it('keeps held outputs and M9 seed publications atomic across a failed machine evaluation', () => {
    const compiled = compileModel(m9RollbackModel()), machine = createDiscreteMachine(compiled.nodes, compiled.stateIds, 1, 0, () => {});
    const first = machine.evaluate(0, 0); machine.transition(first, 0); const second = machine.evaluate(1, 1);
    const checkpoint = machine.checkpoint(), held = machine.snapshot();
    machine.transition(second, 1); expect(() => machine.evaluate(2, 2)).toThrow(ModelError);
    expect(machine.snapshot()).toEqual(held); expect(machine.stateMemory(true)!.operation).toMatchObject({ seed: 3027450565 });
    machine.restore(checkpoint); expect(machine.checkpoint()).toEqual(checkpoint);
  });
  it('pause/resume preserves every sample, channel draw and final state', async () => {
    const compiled = compileModel(m9Model('source.random-configured', { mean: [0, 1], variance: [1, 4], seed: 1 }, {}, { steps: 70 }));
    const baseline = await runModel(compiled); let paused = false, resumed = 0, resolveResume = () => {};
    const pausedRun = await runModel(compiled, {
      control: { isPaused: () => paused, waitForResume: () => new Promise<void>(resolve => { resolveResume = resolve; }) },
      onProgress: progress => { if (progress.steps === 1) paused = true; },
      onPauseChange: active => { if (active) queueMicrotask(() => { paused = false; resumed++; resolveResume(); }); },
    });
    expect(resumed).toBe(1); expect(pausedRun.samples).toEqual(baseline.samples); expect(pausedRun.finalState).toEqual(baseline.finalState); expect(pausedRun.stateMemory).toEqual(baseline.stateMemory);
    const memory = pausedRun.stateMemory!.operation as { previousOutput: number[] }; memory.previousOutput[0] = 999;
    (pausedRun.samples[0]!.values.result as number[])[0] = 999;
    const again = await runModel(compiled); expect(again.samples).toEqual(baseline.samples); expect(again.stateMemory).toEqual(baseline.stateMemory);
  });
  it('checks work and record limits before evaluating an M9 stateful node', async () => {
    const compiled = compileModel(m9Model('discrete.filter', {}, { in: [1, 2, 3] }));
    await expect(runModel(compiled, { maxOperations: 1 })).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: 'RUNTIME_OPERATION_BUDGET' })] });
    await expect(runModel(compiled, { maxRecordedValues: 1 })).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: 'RUNTIME_RECORD_BUDGET' })] });
  });
  it('rechecks actual M9 queue memory even if an external IR descriptor understates it', async () => {
    const compiled = structuredClone(compileModel(m9Model('discrete.propagation-delay', { initial: Array(16).fill(0), capacity: 1 }, { in: [Array(16).fill(1)], delay: [2] }, { units: { delay: 's' } })));
    compiled.nodes.find(node => node.id === 'operation')!.parameters.capacity = 10000;
    await expect(runModel(compiled)).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: 'RUNTIME_STATE_BUDGET' })] });
  });
  it('charges tapped delay linearly in its actual fixed-width storage', async () => {
    const run = await runModel(compileModel(m9Model('discrete.tapped-delay', { taps: 1024 }, { in: [1] }, { steps: 13 })), { trackOperations: true });
    expect(run.samples).toHaveLength(13); expect((run.samples.at(-1)!.values.result as number[]).slice(0, 13)).toEqual([...Array(12).fill(1), 0]);
    expect(run.resources!.operations).toBeLessThan(1_000_000);
  });
  it('has a raw oracle for every new registry id and every supported hybrid id', () => {
    const coverage = (mode: string) => [...new Set(M9_FIXTURES.filter(entry => entry.model.execution.mode === mode).map(entry => entry.model.nodes.find(node => node.id === 'operation')!.blockType))].sort();
    expect(coverage('discrete')).toEqual([...M9_BLOCK_IDS].sort()); expect(coverage('continuous')).toEqual(M9_BLOCK_IDS.filter(id => id !== 'verify.gradient').sort());
  });
});
