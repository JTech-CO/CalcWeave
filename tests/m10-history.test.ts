import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { createExportManifest } from '../packages/codegen-ts/src';
import { ENGINE_VERSION, type TypedSignal } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';
import { appendHistory, historySnapshot, type HistoryRecord } from '../apps/web/src/run-history';
import { m10IndependentGraph, m10IndependentTyped, m10IndependentFixed } from './m10-independent-fixtures';

async function record(value: TypedSignal): Promise<HistoryRecord> {
  const model = m10IndependentGraph('signal.representation', {}, { in: value }, { out: value });
  const compiled = compileModel(model), manifest = await createExportManifest(compiled);
  return { id: 'm10-run', label: 'Typed history', createdAt: '2026-10-03T03:00:00Z', model: structuredClone(compiled.model), semanticHash: manifest.modelHash, engineVersion: ENGINE_VERSION, manifest, result: await runModel(compiled), outputIds: compiled.outputIds, outputTypes: compiled.outputTypes };
}

describe('M10 exact bounded execution history', () => {
  it.each([
    m10IndependentTyped('uint64', ['18446744073709551615']),
    m10IndependentFixed(['9007199254740993'], [], 64, 10),
    m10IndependentTyped('complex128', [{ re: '-0', im: 2 }]),
    m10IndependentTyped('float64', ['NaN', 'Infinity', '-Infinity', '-0'], [4]),
    m10IndependentTyped('float32', [0, 16777216], [1, 1, 2]),
    m10IndependentTyped('string', ['=1+1', '<script>'], [2]),
    m10IndependentTyped('enum', ['On'], [], { enum: { name: 'Mode', labels: ['Off', 'On'] } }),
  ])('stores and detaches an actual $dtype calculation without losing wire values', async value => {
    const input = await record(value), original = structuredClone(input), saved = appendHistory([], input);
    expect(saved).toEqual([original]);
    const output = input.result.samples[0]!.values.result_out as TypedSignal;
    output.data[0] = value.dtype === 'complex128' ? { re: 99, im: 99 } : value.dtype === 'float32' ? 99 : 'changed';
    expect(saved[0]).toEqual(original);
    expect(historySnapshot(saved[0]!)).toEqual(original);
  });
  it('rejects a valid typed payload with a different dtype, fixed scale or shape than its manifest', async () => {
    const valid = await record(m10IndependentFixed(['3', '5'], [2], 8, 2));
    for (const replacement of [m10IndependentFixed(['3', '5'], [2], 8, 3), m10IndependentFixed(['3', '5'], [1, 2], 8, 2), m10IndependentTyped('int8', ['3', '5'], [2])]) {
      const corrupted = structuredClone(valid); corrupted.result.samples[0]!.values.result_out = replacement;
      const before = JSON.stringify(corrupted); expect(() => historySnapshot(corrupted)).toThrow(/자료형/); expect(JSON.stringify(corrupted)).toBe(before);
    }
  });
  it('rejects malformed integer codes and counts text storage against the history budget', async () => {
    const corrupted = await record(m10IndependentTyped('int64', ['9007199254740993']));
    (corrupted.result.samples[0]!.values.result_out as TypedSignal).data[0] = '1e16';
    expect(() => historySnapshot(corrupted)).toThrow(/자료형/);
    const large = await record(m10IndependentTyped('string', ['x']));
    large.result.samples = Array.from({ length: 200 }, (_, time) => ({ time, values: { result_out: m10IndependentTyped('string', ['x']) } })); large.result.steps = 200;
    expect(() => historySnapshot(large)).toThrow(/200,000/);
  });
});
