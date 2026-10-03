import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { createExportManifest } from '../packages/codegen-ts/src';
import { ENGINE_VERSION, ModelError } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';
import { createM14Examples } from '../apps/web/src/m14-examples';
import { historySnapshot, type HistoryRecord } from '../apps/web/src/run-history';
async function record(index = 3): Promise<HistoryRecord> {
  const compiled = compileModel(createM14Examples()[index].model), manifest = await createExportManifest(compiled);
  return { id: 'M14record', label: 'M14', createdAt: '2026-10-03T10:00:00Z', model: compiled.model, semanticHash: manifest.modelHash, engineVersion: ENGINE_VERSION, manifest, result: await runModel(compiled), outputIds: compiled.outputIds, outputTypes: compiled.outputTypes };
}
describe('M14 actual adapter lifecycle history boundaries', () => {
  it('roundtrips detached completed WASM lifecycle receipts without changing JSON state', async () => { const original = await record(), copy = historySnapshot(original); expect(copy).toEqual(original); original.result.adapterLifecycle![0].nodeId = 'changed'; expect(copy.result.adapterLifecycle![0].nodeId).toBe('first'); expect(historySnapshot(copy)).toEqual(copy); });
  it('accepts historical records without the optional field and entities without WASM lifecycle', async () => { const legacy = await record(); delete legacy.result.adapterLifecycle; expect(historySnapshot(legacy).result.adapterLifecycle).toBeUndefined(); const entity = await record(5); entity.result.adapterLifecycle = []; expect(historySnapshot(entity)).toEqual(entity); });
  for (const mutation of ['node', 'profile', 'initialized', 'terminated', 'reason', 'duplicate', 'missing', 'extra', 'entity'] as const) it(`rejects forged lifecycle ${mutation}`, async () => {
    const changed = await record(), rows = changed.result.adapterLifecycle!;
    if (mutation === 'node') rows[0].nodeId = 'one'; if (mutation === 'profile') rows[0].profileId = 'calcweave.entity-fixed-deadline-v1';
    if (mutation === 'initialized') Reflect.set(rows[0], 'initialized', false); if (mutation === 'terminated') Reflect.set(rows[0], 'terminated', false); if (mutation === 'reason') rows[0].reason = 'cancelled';
    if (mutation === 'duplicate') rows[1] = structuredClone(rows[0]); if (mutation === 'missing') rows.pop(); if (mutation === 'extra') Reflect.set(rows[0], 'arbitrary', 1);
    if (mutation === 'entity') { const entity = await record(5); entity.result.adapterLifecycle = [rows[0]]; expect(() => historySnapshot(entity)).toThrow(/종료 기록|확장 상태/); return; }
    expect(() => historySnapshot(changed)).toThrow(/종료 기록|확장 상태/);
  });
  it('checks cancellation/failure reasons and bounded subset receipts against compiled nodes', async () => {
    for (const status of ['cancelled', 'failed'] as const) { const changed = await record(); changed.result.status = status; changed.result.adapterLifecycle = [ { ...changed.result.adapterLifecycle![0], reason: status } ]; expect(historySnapshot(changed).result.adapterLifecycle).toHaveLength(1); changed.result.adapterLifecycle[0].reason = 'completed'; expect(() => historySnapshot(changed)).toThrow(/원인/); }
  });
  it('accepts an actual failed WASM run with terminated initialized instances and a complete prior sample', async () => {
    const model = createM14Examples()[3].model; model.nodes.find(node => node.id === 'one')!.parameters.value = 2; model.nodes.find(node => node.id === 'first')!.parameters.gain = Number.MAX_VALUE;
    const compiled = compileModel(model), manifest = await createExportManifest(compiled);
    let failure: ModelError | undefined; try { await runModel(compiled); } catch (error) { if (error instanceof ModelError) failure = error; else throw error; }
    expect(failure?.diagnostics[0].code).toBe('M14_ADAPTER_NONFINITE'); const result = failure!.partialResult!; expect(result.status).toBe('failed'); expect(result.samples).toHaveLength(1); expect(result.samples[0].values['first-result']).toBe(0); expect(result.adapterLifecycle).toHaveLength(2);
    const saved: HistoryRecord = { id: 'M14failed', label: 'failed', createdAt: '2026-10-03T10:00:00Z', model: compiled.model, semanticHash: manifest.modelHash, engineVersion: ENGINE_VERSION, manifest, result, outputIds: compiled.outputIds, outputTypes: compiled.outputTypes };
    expect(historySnapshot(saved)).toEqual(saved); expect(saved.result.adapterLifecycle!.every(row => row.reason === 'failed')).toBe(true);
  });
});
