import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describeAnySignal, validateAnySignal, type BusSignal, type MessageSignal, type TypedSignal } from '../packages/model/src';
import { parseSignalValueDraft, STRUCTURED_DRAFT_LIMIT, StructuredSignalField } from '../apps/web/src/components/StructuredSignalField';
import { descriptorLabel, signalSummary, SignalResult } from '../apps/web/src/components/SignalResult';
import { plotSignalNumber, ResultPlot } from '../apps/web/src/components/ResultPlot';
import { TemporalSignalResult } from '../apps/web/src/components/TemporalSignalResult';

const integer: TypedSignal = { kind: 'typed', dtype: 'uint64', shape: [], data: ['18446744073709551615'] };
const bus: BusSignal = { kind: 'bus', fields: [{ name: 'counter', value: integer }, { name: 'nested', value: { kind: 'bus', fields: [{ name: 'precise', value: 1.2345678901234567 }, { name: 'text', value: { kind: 'typed', dtype: 'string', shape: [], data: ['<img src=x onerror=alert(1)>'] } }] } }] };
const messages: MessageSignal = { kind: 'messages', items: [{ producer: 'sender', sequence: 7, time: .123456789012345, priority: 2, payload: bus }] };
const markup = (value: BusSignal | MessageSignal) => renderToStaticMarkup(createElement(SignalResult, { value, label: '원본 결과' }));

describe('M11 bounded structured editor and raw results', () => {
  it('keeps uint64 strings and ordered nested bus fields through JSON draft edits', () => {
    const result = parseSignalValueDraft(JSON.stringify(bus));
    expect(result).toEqual(bus); expect(result).not.toBe(bus);
    expect(signalSummary(result)).toBe('버스 · 2개 필드');
    expect(descriptorLabel(describeAnySignal(result))).toBe('이름 있는 버스 · 2개 필드');
    const wrong = { kind: 'typed', dtype: 'uint64', shape: [], data: [18446744073709551615] };
    expect(() => parseSignalValueDraft(JSON.stringify(wrong))).toThrow();
  });
  it('rejects oversized/deep drafts, duplicate fields, unknown objects, and nested messages', () => {
    expect(() => parseSignalValueDraft(' '.repeat(STRUCTURED_DRAFT_LIMIT + 1))).toThrow();
    expect(() => parseSignalValueDraft('['.repeat(41) + '0' + ']'.repeat(41))).toThrow();
    expect(() => parseSignalValueDraft('{"shape":[],"data":[1]}')).toThrow();
    expect(() => parseSignalValueDraft('{"kind":"bus","fields":[{"name":"x","value":1},{"name":"x","value":2}]}')).toThrow();
    expect(() => validateAnySignal({ kind: 'messages', items: [{ producer: 'sender', sequence: 0, time: 0, priority: 0, payload: { kind: 'messages', items: [] } }] })).toThrow();
  });
  it('renders an exact, escaped nested result tree instead of coercing bus values to typed', () => {
    const html = markup(bus);
    expect(html).toContain('버스 필드'); expect(html).toContain('18446744073709551615'); expect(html).toContain('1.2345678901234567');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;'); expect(html).not.toContain('<img');
    expect(html.indexOf('<strong>counter</strong>')).toBeLessThan(html.indexOf('<strong>nested</strong>'));
  });
  it('renders message order, exact timestamp, payload, and explicit empty batches', () => {
    const html = markup(messages);
    expect(html).toContain('sender'); expect(html).toContain('0.123456789012345 s'); expect(html).toContain('18446744073709551615');
    expect(signalSummary(messages)).toBe('메시지 · 1개'); expect(descriptorLabel(describeAnySignal(messages))).toContain('메시지 묶음');
    expect(markup({ kind: 'messages', items: [] })).toContain('이 샘플에 메시지가 없습니다.');
  });
  it('shows compiled per-field units through nested buses and message payloads', () => {
    const descriptor = describeAnySignal(bus); descriptor.bus!.fields[0]!.descriptor.unit = 'm';
    descriptor.bus!.fields[1]!.descriptor.bus!.fields[0]!.descriptor.unit = 's';
    const html = renderToStaticMarkup(createElement(SignalResult, { value: bus, descriptor, label: '단위 있는 버스' }));
    expect(html).toContain('uint64 · 스칼라 · m'); expect(html).toContain('float64 · 스칼라 · s');
    const messageDescriptor = describeAnySignal(messages); messageDescriptor.message!.payload = descriptor;
    expect(renderToStaticMarkup(createElement(SignalResult, { value: messages, descriptor: messageDescriptor, label: '단위 있는 payload' }))).toContain('uint64 · 스칼라 · m');
  });
  it('bounds typed arrays within a bus to the existing 100-row page', () => {
    const value: BusSignal = { kind: 'bus', fields: [{ name: 'samples', value: { kind: 'typed', dtype: 'int16', shape: [202], data: Array.from({ length: 202 }, (_, index) => String(index)) } }] };
    const html = markup(value);
    expect(html).toContain('1–100 / 202개'); expect(html).toContain('다음 100개'); expect(html.match(/<tr>/g)).toHaveLength(101);
  });
  it('retains structured temporal samples and gives a specific nonnumeric plot explanation', () => {
    const samples = [{ time: 0, values: { output: messages } }, { time: 1, values: { output: { kind: 'messages' as const, items: [] } } }];
    expect(plotSignalNumber(bus)).toBeUndefined(); expect(plotSignalNumber(messages)).toBeUndefined();
    expect(renderToStaticMarkup(createElement(ResultPlot, { samples, outputId: 'output', label: '메시지' }))).toContain('필드·payload·발행 순서');
    const html = renderToStaticMarkup(createElement(TemporalSignalResult, { samples, outputId: 'output', label: '메시지' }));
    expect(html).toContain('구조화 샘플 번호'); expect(html).toContain('2 / 2 샘플'); expect(html).toContain('이 샘플에 메시지가 없습니다.');
  });
  it('exposes a labelled bounded JSON editor with exact-code guidance', () => {
    const html = renderToStaticMarkup(createElement(StructuredSignalField, { label: '구조화 값', value: bus, onChange: () => {}, setValidity: () => {} }));
    expect(html).toContain('구조화 값 신호 JSON'); expect(html).toContain('maxLength="300000"'); expect(html).toContain('정수 문자열');
  });
});
