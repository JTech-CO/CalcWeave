import { describe, expect, it } from 'vitest';
import { createExample, EXAMPLES } from '../apps/web/src/examples';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { parseModel, serializeModel } from '../packages/model/src';

// Literal learning-model expectations are independent of the engine implementations.
const final = {
  'controlled-independent-states': { 'first-result': 6, 'second-result': 18 },
  'controlled-enable-state': { 'hold-result': 4, 'reset-result': 2 },
  'controlled-trigger-reset': { 'trigger-result': 2, 'reset-result': 2 },
  'controlled-for-iteration': { result: 6 },
  'controlled-while-iteration': { result: 3 },
  'controlled-variant': { result: 6 },
  'structured-nested-bus': { result: { kind: 'bus', fields: [{ name: 'counter', value: { kind: 'typed', dtype: 'uint64', shape: [], data: ['18446744073709551615'] } }, { name: 'status', value: { kind: 'bus', fields: [{ name: 'ready', value: true }, { name: 'temperature', value: { kind: 'typed', dtype: 'fixed', fixed: { signed: true, wordLength: 16, fractionLength: 8 }, shape: [], data: ['385'] } }] } }] }, 'ready-result': true },
  'structured-message-queue': { messages: { kind: 'messages', items: [{ producer: 'sensor', sequence: 3, time: 3, priority: 0, payload: { kind: 'bus', fields: [{ name: 'counter', value: { kind: 'typed', dtype: 'uint64', shape: [], data: ['18446744073709551615'] } }, { name: 'ready', value: true }] } }] }, size: 1 },
} as const;

describe('M11 actual learning-model execution', () => {
  it.each(EXAMPLES.filter(example => example.category === 'hierarchy').map(example => example.id))('%s compiles, runs literal output, and preserves JSON source identities', async id => {
    const model = createExample(id), before = serializeModel(model), compiled = compileModel(model), result = await runModel(compiled);
    expect(result.status).toBe('completed'); expect(result.samples.at(-1)!.values).toEqual(final[id as keyof typeof final]);
    expect(serializeModel(model)).toBe(before);
    const imported = parseModel(JSON.parse(before)); imported.nodes.reverse(); imported.edges.reverse();
    expect((await runModel(compileModel(imported))).samples).toEqual(result.samples);
    if (id === 'controlled-for-iteration' || id === 'controlled-while-iteration') expect(result.samples.map(sample => sample.time)).toEqual([0, 1, 2]);
    if (id === 'structured-message-queue') expect(result.samples[0]!.values.messages).toEqual({ kind: 'messages', items: [] });
  });
});
