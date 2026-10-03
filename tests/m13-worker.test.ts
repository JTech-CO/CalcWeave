import { afterAll, describe, expect, it, vi } from 'vitest';
import { createExample } from '../apps/web/src/examples';
import type { CalcModel } from '../packages/model/src';
let receive: ((event: { data: unknown }) => Promise<void>) | undefined;
const messages: unknown[] = [];
vi.stubGlobal('self', { get onmessage() { return receive; }, set onmessage(handler: typeof receive) { receive = handler; }, postMessage(message: unknown) { messages.push(structuredClone(message)); } });
afterAll(() => vi.unstubAllGlobals());
describe('M13 actual browser Worker execution entry preserves earlier modes', () => {
  for (const id of ['first-calculation', 'typed-int64-boundary', 'continuous-decay', 'dashboard-recorded-controls']) it(`executes ${id} through strict Worker message/runner boundary`, async () => {
    await import('../apps/web/src/engine.worker');
    let model: CalcModel;
    if (id === 'typed-int64-boundary') { model = createExample('first-calculation'); model.nodes = [{ id: 'value', blockType: 'source.typed', blockVersion: 1, label: '정확한 정수', parameters: { value: { kind: 'typed', dtype: 'int64', shape: [], data: ['9223372036854775807'] } } }, { id: 'result', blockType: 'io.structured-output', blockVersion: 1, label: '결과', parameters: {} }]; model.edges = [{ id: 'typed-output', source: { nodeId: 'value', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } }]; model.layout = {}; }
    else model = createExample(id);
    messages.length = 0; await receive!({ data: { type: 'run', requestId: crypto.randomUUID(), model } });
    const error = messages.find(message => (message as { type: string }).type === 'error'); expect(error).toBeUndefined();
    const result = messages.find(message => (message as { type: string }).type === 'result') as { result: { status: string; samples: { values: Record<string, unknown> }[] }; semanticHash: string };
    expect(result.result.status).toBe('completed'); expect(result.semanticHash).toMatch(/^[a-f0-9]{64}$/); if (id === 'first-calculation') expect(result.result.samples[0].values.result).toBe(6); if (id === 'typed-int64-boundary') expect(result.result.samples[0].values.result).toMatchObject({ dtype: 'int64', data: ['9223372036854775807'] });
  });
});
