import { describe, expect, it } from 'vitest';
import { describeAnySignal, validateAnySignal, validateAnyDescriptor, copyAnySignal, structuredStorageElements } from '../packages/model/src/structured';
import { exportResultCsv } from '../packages/data/src';
import { checkSignal } from '../packages/runtime/src/kernels';
import type { BusSignal, MessageSignal, RunResult } from '../packages/model/src/types';
const bus: BusSignal = { kind: 'bus', fields: [{ name: 'integer', value: { kind: 'typed', dtype: 'uint64', shape: [], data: ['18446744073709551615'] } }, { name: 'vector', value: [1, 2] }] };
const message: MessageSignal = { kind: 'messages', items: [{ producer: 'sender', sequence: 2, time: 0.5, priority: -3, payload: bus }] };
describe('M11 bounded structured wire contracts', () => {
  it('preserves exact uint64, field order, nested payload and metadata', () => {
    expect(validateAnySignal(JSON.parse(JSON.stringify(message)))).toEqual(message);
    const descriptor = describeAnySignal(message); expect(validateAnyDescriptor(descriptor)).toEqual(descriptor);
    expect(checkSignal(message, descriptor, 'scope')).toEqual(message);
  });
  it('copies independently and accounts for payload and field names', () => {
    const copied = copyAnySignal(bus) as BusSignal; copied.fields[1]!.value = 9;
    expect(bus.fields[1]!.value).toEqual([1, 2]); expect(structuredStorageElements(bus)).toBe(152);
  });
  it('supports16 scalarfields and64 messages without confusing storage and logical widths', () => {
    expect(validateAnySignal({ kind: 'bus', fields: Array.from({ length: 16 }, (_, i) => ({ name: `f${i}`, value: i })) })).toBeDefined();
    expect(validateAnySignal({ kind: 'messages', items: Array.from({ length: 64 }, (_, i) => ({ producer: 'sender', sequence: i, priority: 0, time: 0, payload: i })) })).toBeDefined();
  });
  for (const invalid of [
    { kind: 'bus', fields: [{ name: 'a', value: 1 }, { name: 'a', value: 2 }] },
    { kind: 'bus', fields: [{ name: '__proto__', value: 1 }] },
    { kind: 'messages', items: [{ producer: 'a', sequence: 0, priority: 0, time: 0, payload: { kind: 'messages', items: [] } }] },
    { kind: 'messages', items: [{ producer: 'a', sequence: -1, priority: 0, time: 0, payload: 1 }] },
    { kind: 'messages', items: [{ producer: 'a', sequence: 0, priority: 0, time: 0, payload: 1 }, { producer: 'a', sequence: 0, priority: 0, time: 1, payload: 2 }] },
  ]) it('rejects malformed identity/nesting/fields', () => expect(() => validateAnySignal(invalid)).toThrow());
  it('rejects accessors without executing them', () => {
    let reads = 0; const value = { kind: 'bus', get fields() { reads++; return []; } };
    expect(() => validateAnySignal(value)).toThrow(); expect(reads).toBe(0);
  });
  it('accepts empty eventbatch against a declared typed payload; rejects wrong code type', () => {
    const descriptor = describeAnySignal(message);
    expect(checkSignal({ kind: 'messages', items: [] }, descriptor, 'queue')).toEqual({ kind: 'messages', items: [] });
    expect(() => checkSignal({ kind: 'messages', items: [{ ...message.items[0]!, payload: 1 }] }, descriptor, 'queue')).toThrow();
  });
  it('CSV contains exact wire and empty batches, escaped spreadsheet text', () => {
    const result: RunResult = { status: 'completed', elapsedMs: 0, steps: 2, finalState: {}, samples: [{ time: 0, values: { out: message } }, { time: 1, values: { out: { kind: 'messages', items: [] } } }] };
    const csv = exportResultCsv(result, { out: '=SUM(1)' });
    expect(csv).toContain('18446744073709551615'); expect(csv).toContain('sequence'); expect(csv).toContain('""items"":[]'); expect(csv).toContain("'=SUM(1)");
  });
});
