import { createElement } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ADAPTER_PROFILES, BUILTIN_ADAPTER_PROFILES, UNAVAILABLE_ADAPTER_PROFILES, type MessageSignal } from '../packages/model/src';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { EXAMPLES, EXAMPLE_CATEGORIES } from '../apps/web/src/examples';
import { createM14Examples } from '../apps/web/src/m14-examples';
import { AdapterCatalogPanel } from '../apps/web/src/components/AdapterCatalogPanel';
import { AdapterProfileDetails, AdapterNodeDetails, AdapterLifecycleSummary } from '../apps/web/src/components/AdapterNodeDetails';
import { BlockNode } from '../apps/web/src/components/BlockNode';

const predecessorIds = ['first-calculation','discrete-feedback','continuous-decay','budget-calculator','vector-shape','formula-calculator','unit-scale','reset-feedback','fir-impulse','multirate-clock','seeded-wave','bit-lookup','discrete-state-space','rk45-decay','continuous-oscillator','continuous-step-response','continuous-pid','continuous-crossing-reset','memory-and-delay','continuous-sample-hold','rk45-controlled-failure','data-playback','hierarchy-edit','units-and-bus','matrix-solve-lu','lookup-2d-nonuniform','quantizer-rounding-overflow','vector-statistics','matrix-diagonal-selection','dead-zone-quantizer-sinc','chirp-sweep','signal-curves','dynamic-limits','nd-lookup','matrix-inspection','filter-realizations','tapped-history','weighted-sample-counter','pid-setpoint-weights','typed-integer64','typed-fixed-overflow','typed-complex-hermitian','typed-tensor-permute','typed-string-enum','typed-ieee-cast','controlled-independent-states','controlled-enable-state','controlled-trigger-reset','controlled-for-iteration','controlled-while-iteration','controlled-variant','structured-nested-bus','structured-message-queue','stiff-implicit-decay','algebraic-square-root','descriptor-index-one','variable-delay-vs-transport','continuous-state-limits','backlash-and-rate-bounds','pid-two-degree-weighting','local-linearization-requests','string-unicode-search','string-compose-scan','string-ascii-roundtrip','dashboard-recorded-controls','dashboard-choice-and-gain','waveform-xy-and-record','named-signal-editor-playback','bounded-record-and-stop'];

describe('M14 adapter presentation and genuine compiled learning models', () => {
  it('adds six unique models and one category while retaining all69 previous entries', () => {
    expect(EXAMPLES).toHaveLength(75); expect(EXAMPLE_CATEGORIES).toHaveLength(12);
    const fresh = createM14Examples(), ids = new Set(fresh.map(example => example.id)); expect(ids.size).toBe(6);
    expect(EXAMPLES.filter(example => !ids.has(example.id)).map(example => example.id)).toEqual(predecessorIds);
    expect(new Set(EXAMPLES.map(example => example.id)).size).toBe(75);
    expect(EXAMPLE_CATEGORIES.map(category => category.id).sort()).toEqual(['basics', 'signals', 'discrete', 'continuous', 'workspace', 'advanced', 'typed', 'hierarchy', 'solver', 'dashboard', 'strings', 'adapters'].sort());
  });
  for (const example of createM14Examples()) it(`executes real UI example ${example.id}`, async () => {
    const before = structuredClone(example.model), compiled = compileModel(example.model), result = await runModel(compiled);
    expect(result.status).toBe('completed'); expect(example.model).toEqual(before);
    const series = (id: string) => result.samples.map(sample => sample.values[id]);
    if (example.id === 'wasm-affine-and-expression') { expect(series('wasm-result')).toEqual([7]); expect(series('expression-result')).toEqual([7]); }
    if (example.id === 'wasm-continuous-decay') { expect(result.samples).toHaveLength(21); expect(series('result').at(-1)).toBeCloseTo(Math.exp(-2), 6); }
    if (example.id === 'wasm-accumulator-resets') { expect(series('rising-result')).toEqual([0, 1, 2, 0, 1, 2, 3]); expect(series('level-result')).toEqual([0, 1, 2, 0, 0, 0, 0]); expect(result.adapterLifecycle?.map(item => item.nodeId).sort()).toEqual(['level', 'rising']); }
    if (example.id === 'wasm-independent-instances') { expect(series('first-result')).toEqual([0, 1, 2, 3]); expect(series('second-result')).toEqual([10, 12, 14, 16]); expect(result.adapterLifecycle).toHaveLength(2); }
    if (example.id === 'entity-fifo-delay') {
      const released = result.samples.flatMap(sample => (sample.values.messages as MessageSignal).items.map(item => ({ acceptedTime: sample.time, item })));
      expect(released.map(entry => entry.item.sequence)).toEqual([0, 1, 2, 3]);
      released.forEach((entry, index) => { expect(entry.acceptedTime).toBeCloseTo(.3 + .1 * index, 12); expect(entry.item).toMatchObject({ producer: 'ticket', time: .1 * index, payload: { kind: 'typed', dtype: 'uint64', shape: [], data: ['18446744073709551615'] } }); });
      expect(series('count')).toEqual([1, 2, 3, 3, 2, 1, 0]); expect(result.adapterLifecycle ?? []).toEqual([]);
    }
    if (example.id === 'entity-capacity-policies') {
      expect((result.samples[2].values['newest-result'] as MessageSignal).items.map(item => item.sequence)).toEqual([1]);
      expect((result.samples[2].values['oldest-result'] as MessageSignal).items.map(item => item.sequence)).toEqual([2]);
      expect((result.samples[2].values['oldest-result'] as MessageSignal).items[0].payload).toMatchObject({ dtype: 'uint64', data: ['9223372036854775808'] });
    }
  });
  it('renders a catalog of three bundled alternatives and eight native requirements without code/upload controls', () => {
    const html = renderToStaticMarkup(createElement(AdapterCatalogPanel));
    expect(html.match(/data-adapter-id=/g)).toHaveLength(11); expect(html).toContain('내장 3개'); expect(html).toContain('원본 환경 8개');
    expect(html).not.toMatch(/type="file"|<textarea|<form|<iframe/);
    expect(html).not.toContain('모듈 실행'); expect(html).not.toContain('코드 실행');
  });
  for (const profile of ADAPTER_PROFILES) it(`renders exact metadata for ${profile.id}`, () => {
    const html = renderToStaticMarkup(createElement(AdapterProfileDetails, { profile }));
    expect(html).toContain(`data-adapter-profile="${profile.id}"`); expect(html).toContain('NOASSERTION'); expect(html).toContain('외부 코드·원본 제품의 사용권');
    if (profile.artifact) { expect(html).toContain(profile.artifact.sha256); expect(html).toContain(`${profile.artifact.byteLength} bytes`); for (const entry of profile.artifact.exports) expect(html).toContain(`${entry.name}(${entry.parameters.join(', ')})`); }
    if (profile.availability === 'unavailable') { expect(html).toContain('원본 환경 미지원'); expect(html).toContain('M14_NATIVE_ENVIRONMENT_UNAVAILABLE'); expect(html).not.toContain('<button'); }
    expect(html).not.toMatch(/type="file"|<textarea|<form/);
  });
  it('escapes provenance text and profile labels rather than introducing executable markup', () => {
    const profile = { ...BUILTIN_ADAPTER_PROFILES[0], label: '<img src=x onerror=alert(1)>', provenance: { ...BUILTIN_ADAPTER_PROFILES[0].provenance, author: '<script>alert(1)</script>' } };
    const html = renderToStaticMarkup(createElement(AdapterProfileDetails, { profile })); expect(html).toContain('&lt;img'); expect(html).toContain('&lt;script'); expect(html).not.toContain('<script>'); expect(html).not.toContain('<img src=x');
  });
  it('keeps the canvas name plus one value, leaving execution metadata in the inspector', () => {
    const block = createM14Examples()[0].model.nodes.find(node => node.id === 'affine')!;
    const html = renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(BlockNode, { id: block.id, data: { block }, type: 'calcBlock', dragging: false, zIndex: 0, selectable: true, deletable: true, selected: false, draggable: true, isConnectable: true, positionAbsoluteX: 0, positionAbsoluteY: 0 })));
    expect(html).toContain('>WASM Affine</div>'); expect(html.match(/class="block-name[^"]*"[^>]*>(.*?)<\/div>/)?.[1]).not.toContain('Trusted');
    expect(html).not.toContain(BUILTIN_ADAPTER_PROFILES[0].artifact!.sha256);
    expect(renderToStaticMarkup(createElement(AdapterNodeDetails, { node: block }))).toContain(BUILTIN_ADAPTER_PROFILES[0].artifact!.sha256);
    expect(renderToStaticMarkup(createElement(AdapterNodeDetails, { node: createM14Examples()[0].model.nodes[0] }))).toBe('');
  });
  it('shows completed termination only from actual supplied lifecycle records', async () => {
    const result = await runModel(compileModel(createM14Examples()[3].model));
    const html = renderToStaticMarkup(createElement(AdapterLifecycleSummary, { result })); expect(html).toContain('종료 기록 · 2개'); expect(html.match(/초기화·종료 완료/g)).toHaveLength(2); expect(html).toContain('정상 완료');
    expect(renderToStaticMarkup(createElement(AdapterLifecycleSummary, { result: { ...result, adapterLifecycle: undefined } }))).toBe('');
    expect(UNAVAILABLE_ADAPTER_PROFILES).toHaveLength(8);
  });
});
