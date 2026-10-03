import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { dataTypeDraft, parseDataTypeDraft, parseTypedSignalDraft, TypedDataTypeField, TypedSignalField, TYPED_DRAFT_LIMIT } from '../apps/web/src/components/TypedSignalField';
import { descriptorLabel, fixedCellText, signalSummary, SignalResult, typedCoordinates } from '../apps/web/src/components/SignalResult';
import { plotSignalNumber, ResultPlot } from '../apps/web/src/components/ResultPlot';
import { typedDescriptor, type TypedDataType, type TypedSignal } from '../packages/model/src';

describe('M10 lossless typed editor boundary', () => {
  it.each([
    ['int64', '-9223372036854775808'], ['int64', '9223372036854775807'], ['uint64', '18446744073709551615'],
  ] as const)('keeps %s endpoint %s as exact text for scalar and unquoted flat arrays', (dtype, code) => {
    expect(parseTypedSignalDraft({ dtype }, '[]', code).data).toEqual([code]);
    expect(parseTypedSignalDraft({ dtype }, '[2]', `[${code}, "0"]`).data).toEqual([code, '0']);
  });
  it.each(['9223372036854775808', '-9223372036854775809', '001', '-0', '1e3', '1.2'])('rejects invalid int64 code %s', value => {
    expect(() => parseTypedSignalDraft({ dtype: 'int64' }, '[]', value)).toThrow();
    expect(() => parseTypedSignalDraft({ dtype: 'int64' }, '[1]', `[${value}]`)).toThrow();
  });
  it('rounds float32 input deliberately and tags signed zero', () => {
    expect(parseTypedSignalDraft({ dtype: 'float32' }, '[]', '0.1').data).toEqual([Math.fround(0.1)]);
    expect(parseTypedSignalDraft({ dtype: 'float32' }, '[2]', '[0.1, -0]').data).toEqual([Math.fround(0.1), '-0']);
  });
  it('requires explicit special tags instead of overflowing finite syntax', () => {
    expect(parseTypedSignalDraft({ dtype: 'float64' }, '[]', 'NaN').data).toEqual(['NaN']);
    expect(parseTypedSignalDraft({ dtype: 'float64' }, '[4]', '["NaN","Infinity","-Infinity","-0"]').data).toEqual(['NaN', 'Infinity', '-Infinity', '-0']);
    expect(() => parseTypedSignalDraft({ dtype: 'float64' }, '[]', '1e309')).toThrow();
    expect(() => parseTypedSignalDraft({ dtype: 'float64' }, '[1]', '[1e309]')).toThrow();
  });
  it('edits independent real and imaginary components and canonicalizes signed zero', () => {
    expect(parseTypedSignalDraft({ dtype: 'complex128' }, '[]', '-0', '-2').data).toEqual([{ re: '-0', im: -2 }]);
    expect(parseTypedSignalDraft({ dtype: 'complex128' }, '[1]', '[{"re":-0,"im":"Infinity"}]').data).toEqual([{ re: '-0', im: 'Infinity' }]);
    expect(() => parseTypedSignalDraft({ dtype: 'complex128' }, '[1]', '[{"re":1,"im":2,"extra":3}]')).toThrow();
  });
  it('keeps boolean, string, and enum distinct with explicit enum metadata', () => {
    expect(parseTypedSignalDraft({ dtype: 'boolean' }, '[]', 'false').data).toEqual([false]);
    expect(() => parseTypedSignalDraft({ dtype: 'boolean' }, '[]', '0')).toThrow();
    expect(parseTypedSignalDraft({ dtype: 'string' }, '[]', '001').data).toEqual(['001']);
    const type: TypedDataType = { dtype: 'enum', enum: { name: 'Mode', labels: ['Off', 'On'] } };
    expect(parseTypedSignalDraft(type, '[]', 'On').data).toEqual(['On']);
    expect(() => parseTypedSignalDraft(type, '[]', 'Unknown')).toThrow();
  });
  it('checks typed shape, element count, parser depth, and text bounds before commit', () => {
    const type = { dtype: 'float64' } as const;
    expect(() => parseTypedSignalDraft(type, '[2]', '[1]')).toThrow();
    expect(() => parseTypedSignalDraft(type, '[1025]', '[1]')).toThrow();
    expect(() => parseTypedSignalDraft(type, '[2,2,2,2,2,2,2,2,2]', '[1]')).toThrow();
    expect(() => parseTypedSignalDraft(type, '[1]', '[[1]]')).toThrow();
    expect(() => parseTypedSignalDraft(type, '[]', '1'.repeat(TYPED_DRAFT_LIMIT + 1))).toThrow();
    expect(() => parseTypedSignalDraft({ dtype: 'string' }, '[]', 'x'.repeat(257))).toThrow();
  });
  it('round-trips metadata drafts, rejects invalid fixed and enum declarations', () => {
    const signal: TypedSignal = { kind: 'typed', dtype: 'fixed', fixed: { signed: false, wordLength: 64, fractionLength: -64 }, shape: [], data: ['18446744073709551615'] };
    const draft = dataTypeDraft(signal);
    expect(parseDataTypeDraft(draft)).toEqual({ dtype: signal.dtype, fixed: signal.fixed });
    expect(() => parseDataTypeDraft({ ...draft, wordLength: '65' })).toThrow();
    expect(() => parseDataTypeDraft({ ...draft, fractionLength: '-65' })).toThrow();
    expect(() => parseDataTypeDraft({ ...draft, dtype: 'enum', enumLabels: '["On","On"]' })).toThrow();
    expect(() => parseDataTypeDraft({ ...draft, dtype: 'enum', enumName: '../bad' })).toThrow();
  });
  it('renders controlled fields with escaped text, bounded values, and descriptive labels', () => {
    const value: TypedSignal = { kind: 'typed', dtype: 'string', shape: [], data: ['<script>alert(1)</script>'] };
    const html = renderToStaticMarkup(createElement(TypedSignalField, { label: '자료형 값', value, onChange: () => {}, setValidity: () => {} }));
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;'); expect(html).not.toContain('<script>');
    expect(html).toContain('aria-label="자료형 값 자료형"'); expect(html).toContain('maxLength="256"');
    const typeHtml = renderToStaticMarkup(createElement(TypedDataTypeField, { label: '출력 자료형', value: { dtype: 'fixed', fixed: { signed: true, wordLength: 16, fractionLength: 8 } }, onChange: () => {}, setValidity: () => {} }));
    expect(typeHtml).toContain('aria-label="출력 자료형 소수 비트 수"');
  });
});

describe('M10 exact result rendering', () => {
  it('uses explicit finite real float64 approximations only for typed curves', () => {
    expect(plotSignalNumber({ kind: 'typed', dtype: 'uint64', shape: [], data: ['18446744073709551615'] })).toBe(Number('18446744073709551615'));
    expect(plotSignalNumber({ kind: 'typed', dtype: 'fixed', fixed: { signed: true, wordLength: 16, fractionLength: 8 }, shape: [], data: ['128'] })).toBe(.5);
    expect(plotSignalNumber({ kind: 'typed', dtype: 'float32', shape: [], data: [Math.fround(.1)] })).toBe(Math.fround(.1));
    expect(plotSignalNumber({ kind: 'typed', dtype: 'float64', shape: [], data: ['-0'] })).toBe(-0);
    for (const dtype of ['boolean', 'string', 'complex128'] as const) expect(plotSignalNumber({ kind: 'typed', dtype, shape: [], data: [dtype === 'boolean' ? true : dtype === 'string' ? '1' : { re: 1, im: 0 }] })).toBeUndefined();
    expect(plotSignalNumber({ kind: 'typed', dtype: 'float64', shape: [1], data: [1] })).toBeUndefined();
  });
  it('declares typed visualization precision and refuses to bridge IEEE special samples', () => {
    const value: TypedSignal = { kind: 'typed', dtype: 'float64', shape: [], data: [1] };
    const finite = renderToStaticMarkup(createElement(ResultPlot, { label: '자료형', outputId: 'result', samples: [{ time: 0, values: { result: value } }, { time: 1, values: { result: { ...value, data: [2] } } }] }));
    expect(finite).toContain('float64 시각화'); expect(finite).toContain('<path');
    const special = renderToStaticMarkup(createElement(ResultPlot, { label: '자료형', outputId: 'result', samples: [{ time: 0, values: { result: value } }, { time: 1, values: { result: { ...value, data: ['NaN'] } } }, { time: 2, values: { result: value } }] }));
    expect(special).toContain('NaN·무한대'); expect(special).not.toContain('<svg');
  });
  it('formats fixed values with exact BigInt decimal scaling', () => {
    expect(fixedCellText('9223372036854775807', 1)).toBe('4611686018427387903.5');
    expect(fixedCellText('-1', 64)).toBe('-0.0000000000000000000542101086242752217003726400434970855712890625');
    expect(fixedCellText('3', -4)).toBe('48'); expect(fixedCellText('0', 8)).toBe('0');
    expect(() => fixedCellText('1', 1_000_000)).toThrow();
  });
  it('preserves integer endpoints, IEEE tags, complex signed zero, and real descriptor metadata', () => {
    const integer: TypedSignal = { kind: 'typed', dtype: 'uint64', shape: [], data: ['18446744073709551615'] };
    expect(signalSummary(integer)).toBe('18446744073709551615');
    expect(signalSummary({ kind: 'typed', dtype: 'float64', shape: [], data: ['-0'] })).toBe('-0');
    expect(signalSummary({ kind: 'typed', dtype: 'complex128', shape: [], data: [{ re: '-0', im: '-0' }] })).toBe('-0 − 0i');
    const fixed: TypedSignal = { kind: 'typed', dtype: 'fixed', fixed: { signed: true, wordLength: 16, fractionLength: 8 }, shape: [2, 2, 2], data: Array(8).fill('1') };
    expect(descriptorLabel(typedDescriptor(fixed))).toBe('fixed · signed 16비트 · 소수 8비트 · 3D [2 × 2 × 2] · 단위 없음');
  });
  it('uses row-major coordinates through rank eight and limits the first page to 100 rows', () => {
    expect(typedCoordinates(119, [2, 3, 4, 5])).toEqual([1, 2, 3, 4]);
    expect(typedCoordinates(255, Array(8).fill(2))).toEqual(Array(8).fill(1));
    const value: TypedSignal = { kind: 'typed', dtype: 'uint64', shape: [101], data: Array.from({ length: 101 }, (_, index) => String(index)) };
    const html = renderToStaticMarkup(createElement(SignalResult, { label: '정수', value }));
    expect((html.match(/<th scope="row">/g) ?? []).length).toBe(100);
    expect(html).toContain('1–100 / 101개'); expect(html).toContain('다음 100개');
  });
  it('escapes labels and string cells instead of rendering markup', () => {
    const value: TypedSignal = { kind: 'typed', dtype: 'string', shape: [1], data: ['<img src=x onerror=alert(1)>'] };
    const html = renderToStaticMarkup(createElement(SignalResult, { label: '<script>bad</script>', value }));
    expect(html).toContain('&lt;img'); expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>'); expect(html).not.toContain('<img');
  });
  it('preserves legacy summaries, descriptors, and result formatting', () => {
    expect(signalSummary([[1, 2], [3, 4]])).toBe('2 × 2');
    expect(descriptorLabel({ valueType: 'float64', shape: [2, 2], unit: 'm' })).toBe('float64 · 2D [2 × 2] · m');
    expect(renderToStaticMarkup(createElement(SignalResult, { label: '기존', value: [1, 2] }))).toContain('인덱스');
  });
});
