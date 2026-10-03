import { describe, expect, it } from 'vitest';
import { M10_BLOCK_IDS, M10_BLOCK_PRESETS } from '../packages/block-library/src/m10';
import { compileModel } from '../packages/compiler/src';
import { ModelError, parseModel, type RunResult } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';
import { M10_INDEPENDENT_DEFINITION_FIXTURES, M10_INDEPENDENT_FIXTURES, M10_INDEPENDENT_FAILURE_FIXTURES, M10_INDEPENDENT_PRESET_FIXTURES, m10IndependentMode, type M10IndependentFixture } from './m10-independent-fixtures';

function assertLiteral(result: RunResult, entry: M10IndependentFixture): void {
  expect(result.status).toBe('completed');
  for (const [id, values] of Object.entries(entry.expected)) expect(result.samples.map(sample => sample.values[id]), `${entry.name}/${id}`).toEqual(values);
  if (entry.expectedFinalState) expect(result.finalState).toEqual(entry.expectedFinalState);
  if (entry.expectedStateMemory) expect(result.stateMemory).toEqual(entry.expectedStateMemory);
}
const runs = [...M10_INDEPENDENT_FIXTURES, ...M10_INDEPENDENT_PRESET_FIXTURES].flatMap(entry => entry.declaredModes.map(mode => m10IndependentMode(entry, mode)));

describe('M10 independent literal pipelines through actual compilation and execution', () => {
  it('accounts for every declared definition and every configured preset without counting aliases as kernels', () => {
    expect(M10_INDEPENDENT_DEFINITION_FIXTURES).toHaveLength(34);
    expect(new Set(M10_INDEPENDENT_DEFINITION_FIXTURES.map(entry => entry.model.nodes.find(node => node.id === 'operation')!.blockType))).toEqual(new Set(M10_BLOCK_IDS));
    expect(M10_INDEPENDENT_PRESET_FIXTURES).toHaveLength(10);
    expect(new Set(M10_INDEPENDENT_PRESET_FIXTURES.map(entry => entry.presetId))).toEqual(new Set(M10_BLOCK_PRESETS.map(entry => entry.id)));
    expect(new Set(runs.map(entry => entry.name)).size).toBe(runs.length);
  });
  it.each(runs.map(entry => [entry.name, entry] as const))('%s matches raw typed/bit/shape literals after JSON and reversed insertion', async (_name, entry) => {
    const parsed = parseModel(JSON.parse(JSON.stringify(entry.model)));
    const first = await runModel(compileModel(parsed)); assertLiteral(first, entry);
    const reversed = structuredClone(parsed); reversed.nodes.reverse(); reversed.edges.reverse();
    const second = await runModel(compileModel(reversed)); assertLiteral(second, entry);
    expect(second.samples).toEqual(first.samples); expect(second.finalState).toEqual(first.finalState); expect(second.stateMemory).toEqual(first.stateMemory);
    // A fresh run owns state; previously returned typed samples cannot change a later run.
    const fresh = await runModel(compileModel(parsed)); assertLiteral(fresh, entry);
  });
  it.each(M10_INDEPENDENT_FAILURE_FIXTURES.map(entry => [entry.name, entry] as const))('%s reports the original node and preserves atomic partial state', async (_name, entry) => {
    const compiled = compileModel(parseModel(JSON.parse(JSON.stringify(entry.model))));
    const run = async () => {
      try { await runModel(compiled); } catch (error) {
        expect(error).toBeInstanceOf(ModelError);
        const failed = error as ModelError;
        expect(failed.diagnostics.some(diagnostic => diagnostic.code === entry.diagnosticCode && diagnostic.nodeId === entry.nodeId)).toBe(true);
        if (entry.expectedPartial) { expect(failed.partialResult?.status).toBe('failed'); expect(failed.partialResult?.samples).toHaveLength(entry.expectedPartial.samples); expect(failed.partialResult?.finalState).toEqual(entry.expectedPartial.finalState); expect(failed.partialResult?.stateMemory).toEqual(entry.expectedPartial.stateMemory); }
        return;
      }
      throw new Error(`${entry.name} should have failed`);
    };
    await run(); await run();
  });
});
