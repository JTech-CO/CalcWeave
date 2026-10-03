import { describe, expect, it } from 'vitest';
import { exportResultCsv } from '../packages/data/src';
import { type RunResult, type SignalValue, type TypedSignal } from '../packages/model/src';

function result(values: Record<string, SignalValue>, next?: Record<string, SignalValue>): RunResult {
  return { samples: [{ time: 0, values }, ...(next ? [{ time: 1, values: next }] : [])], finalState: {}, status: 'completed', elapsedMs: 0, steps: next ? 1 : 0 };
}
const uint: TypedSignal = { kind: 'typed', dtype: 'uint64', shape: [], data: ['18446744073709551615'] };
describe('M10 typed result presentation CSV', () => {
  it('keeps exact 64-bit payloads as explicit text and declares shape', () => {
    expect(exportResultCsv(result({ a: uint }))).toBe('time (s),a [uint64; shape=[]]\r\n0,uint64:18446744073709551615\r\n');
    const signed: TypedSignal = { kind: 'typed', dtype: 'int64', shape: [2], data: ['-9223372036854775808', '9223372036854775807'] };
    const csv = exportResultCsv(result({ a: signed }));
    expect(csv).toContain('int64:-9223372036854775808,int64:9223372036854775807');
    expect(csv).toContain('a[0] [int64; shape=[2]]');
  });
  it('records fixed stored codes and the exact signed/WL/FL declaration', () => {
    const fixed: TypedSignal = { kind: 'typed', dtype: 'fixed', fixed: { signed: true, wordLength: 64, fractionLength: 16 }, shape: [], data: ['9223372036854775807'] };
    expect(exportResultCsv(result({ fixed }))).toContain('fixed; signed=true; WL=64; FL=16; shape=[]');
    expect(exportResultCsv(result({ fixed }))).toContain('fixed:9223372036854775807');
  });
  it('keeps IEEE tags and uses independent real/imaginary columns', () => {
    const special: TypedSignal = { kind: 'typed', dtype: 'float64', shape: [4], data: ['-0', 'NaN', 'Infinity', '-Infinity'] };
    const complex: TypedSignal = { kind: 'typed', dtype: 'complex128', shape: [], data: [{ re: '-0', im: '-Infinity' }] };
    const csv = exportResultCsv(result({ a: special, z: complex }));
    expect(csv).toContain('float64:-0,float64:NaN,float64:Infinity,float64:-Infinity,float64:-0,float64:-Infinity');
    expect(csv).toContain('z.re [complex128; shape=[]],z.im [complex128; shape=[]]');
  });
  it('retains exact Unicode and spreadsheet formula strings as inert tagged text', () => {
    const string: TypedSignal = { kind: 'typed', dtype: 'string', shape: [3], data: ['=HYPERLINK("evil")', '\t@cmd', '한글🙂\n"quoted"'] };
    const csv = exportResultCsv(result({ a: string }), { a: '=unsafe' });
    expect(csv).toContain("'=unsafe[0]"); expect(csv).toContain('"string:=HYPERLINK(""evil"")"');
    expect(csv).toContain('string:\t@cmd'); expect(csv).toContain('"string:한글🙂\n""quoted"""');
  });
  it('declares enum name and labels rather than treating it as an untyped string', () => {
    const enumeration: TypedSignal = { kind: 'typed', dtype: 'enum', enum: { name: 'Mode', labels: ['Off', 'On'] }, shape: [], data: ['On'] };
    const csv = exportResultCsv(result({ a: enumeration }));
    expect(csv).toContain('enum; name=Mode; labels=[""Off"",""On""]; shape=[]'); expect(csv).toContain('enum:On');
  });
  it('combines typed and legacy outputs without changing the legacy cell format', () => {
    expect(exportResultCsv(result({ a: uint, z: [1, -2] }))).toBe('time (s),a [uint64; shape=[]],z[0],z[1]\r\n0,uint64:18446744073709551615,1,-2\r\n');
  });
  it.each([
    { ...uint, dtype: 'int64', data: ['1'] },
    { ...uint, shape: [1] },
    { kind: 'typed', dtype: 'fixed', fixed: { signed: false, wordLength: 64, fractionLength: 0 }, shape: [], data: ['1'] },
    [1],
  ] as SignalValue[])('rejects output type or shape changes across samples', changed => {
    expect(() => exportResultCsv(result({ a: uint }, { a: changed }))).toThrow();
  });
  it('rejects a same-width fixed scale change and enum declaration change', () => {
    const fixed: TypedSignal = { kind: 'typed', dtype: 'fixed', fixed: { signed: true, wordLength: 16, fractionLength: 8 }, shape: [], data: ['1'] };
    expect(() => exportResultCsv(result({ a: fixed }, { a: { ...fixed, fixed: { ...fixed.fixed!, fractionLength: 7 } } }))).toThrow();
    const enumeration: TypedSignal = { kind: 'typed', dtype: 'enum', enum: { name: 'Mode', labels: ['Off', 'On'] }, shape: [], data: ['On'] };
    expect(() => exportResultCsv(result({ a: enumeration }, { a: { ...enumeration, enum: { name: 'Other', labels: ['Off', 'On'] } } }))).toThrow();
  });
  it('rejects malformed typed payloads and accessors without executing them', () => {
    expect(() => exportResultCsv(result({ a: { ...uint, data: ['18446744073709551616'] } }))).toThrow();
    let invoked = false;
    const value = { ...uint };
    Object.defineProperty(value, 'data', { enumerable: true, get() { invoked = true; return ['1']; } });
    expect(() => exportResultCsv(result({ a: value }))).toThrow(); expect(invoked).toBe(false);
  });
  it('rejects inconsistent output sets, invalid times, and oversized labels', () => {
    expect(() => exportResultCsv(result({ a: uint }, { b: uint }))).toThrow();
    const bad = result({ a: uint }); bad.samples[0]!.time = Infinity;
    expect(() => exportResultCsv(bad)).toThrow();
    expect(() => exportResultCsv(result({ a: uint }), { a: 'x'.repeat(1_001) })).toThrow();
  });
  it('rejects cell-budget overflow before constructing the result table', () => {
    const vector: TypedSignal = { ...uint, shape: [1024], data: Array(1024).fill('1') };
    const oversized = result({ a: vector }); oversized.samples = Array.from({ length: 977 }, (_, index) => ({ time: index, values: { a: vector } }));
    expect(() => exportResultCsv(oversized)).toThrow('1,000,000');
    expect(() => exportResultCsv(result(Object.fromEntries(Array.from({ length: 1001 }, (_, index) => [`a${index}`, uint]))))).toThrow('상한');
  });
  it('preserves existing legacy CSV exactly, including formula-safe labels', () => {
    const legacy = result({ z: false, a: [[1, 2], [3, 4]] }, { z: true, a: [[5, 6], [7, 8]] });
    expect(exportResultCsv(legacy, { z: '=value' })).toBe("time (s),a[0],a[1],a[2],a[3],'=value\r\n0,1,2,3,4,false\r\n1,5,6,7,8,true\r\n");
  });
});
