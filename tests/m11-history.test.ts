import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { createExportManifest } from '../packages/codegen-ts/src';
import { ENGINE_VERSION, type BusSignal, type MessageSignal, type SignalValue } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';
import { appendHistory, historySnapshot, type HistoryRecord } from '../apps/web/src/run-history';

const bus: BusSignal = { kind: 'bus', fields: [{ name: 'exact', value: { kind: 'typed', dtype: 'uint64', shape: [], data: ['18446744073709551615'] } }, { name: 'nested', value: { kind: 'bus', fields: [{ name: 'vector', value: [1, 2] }] } }] };
const message: MessageSignal = { kind: 'messages', items: [{ producer: 'Sender', sequence: 17, time: 0.25, priority: -2, payload: bus }] };
async function record(value: SignalValue): Promise<HistoryRecord> {
  const compiled = compileModel({ schemaVersion: 1, modelId: 'M11History', name: 'M11 history', nodes: [{ id: 'Source', blockType: 'source.signal', blockVersion: 1, label: 'Source', parameters: { value } }, { id: 'Result', blockType: 'sink.scope', blockVersion: 1, label: 'Result', parameters: {} }], edges: [{ id: 'Link', source: { nodeId: 'Source', portId: 'out' }, target: { nodeId: 'Result', portId: 'in' } }], layout: {}, execution: { mode: 'discrete', startTime: 0, stopTime: 1, step: 1 } });
  const manifest = await createExportManifest(compiled);
  return { id: 'm11-history', label: 'Structured history', createdAt: '2026-10-03T05:00:00Z', model: structuredClone(compiled.model), semanticHash: manifest.modelHash, engineVersion: ENGINE_VERSION, manifest, result: await runModel(compiled), outputIds: compiled.outputIds, outputTypes: compiled.outputTypes };
}

describe('M11 real structured execution history', () => {
  it.each([bus, message])('roundtrips exact fields, uint64 and message identity in detached history', async value => {
    const input = await record(value), original = structuredClone(input), saved = appendHistory([], input);
    expect(saved).toEqual([original]);
    input.result.samples[0]!.values.Result = 99;
    expect(saved[0]).toEqual(original); expect(historySnapshot(saved[0]!)).toEqual(original);
  });
  it('rejects nested field names and valid but different exact payload dtype', async () => {
    const original = await record(message);
    for (const change of ['name', 'dtype'] as const) {
      const changed = structuredClone(original), payload = (changed.result.samples[0]!.values.Result as MessageSignal).items[0]!.payload as BusSignal;
      if (change === 'name') payload.fields[0]!.name = 'other';
      else payload.fields[0]!.value = { kind: 'typed', dtype: 'int64', shape: [], data: ['9223372036854775807'] };
      expect(() => historySnapshot(changed)).toThrow(/자료형/);
    }
  });
  it('rejects unsupported units inside nested metadata even if both manifest copies agree', async () => {
    const changed = structuredClone(await record(bus));
    changed.outputTypes.Result!.bus!.fields[1]!.descriptor.bus!.fields[0]!.descriptor.unit = 'unsupported-unit';
    changed.manifest.outputTypes = structuredClone(changed.outputTypes);
    expect(() => historySnapshot(changed)).toThrow(/자료형/);
  });
  it('counts nested text and message bookkeeping against the complete history budget', async () => {
    const changed = await record(message);
    changed.result.samples = Array.from({ length: 1500 }, (_, time) => ({ time, values: { Result: structuredClone(message) } })); changed.result.steps = 1500;
    expect(() => historySnapshot(changed)).toThrow(/200,000/);
  });
  it('rejects accessors without running imported code', async () => {
    const changed = await record(bus); let reads = 0;
    Object.defineProperty(changed.result.samples[0]!.values, 'Result', { enumerable: true, get() { reads++; return bus; } });
    expect(() => historySnapshot(changed)).toThrow(/접근자/); expect(reads).toBe(0);
  });
});
