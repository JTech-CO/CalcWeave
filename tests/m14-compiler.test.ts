import { readFileSync } from 'node:fs';
import { registryWithoutApprovedObserverInputs } from '../scripts/m16-support-source';
import { describe, expect, it } from 'vitest';
import { blockRegistry, getBlockDefinition, getDirectFeedthroughPorts } from '../packages/block-library/src';
import { M14_BLOCK_IDS } from '../packages/block-library/src/m14';
import { compileModel } from '../packages/compiler/src';
import { ADAPTER_PROFILES, BUILTIN_ADAPTER_PROFILES, UNAVAILABLE_ADAPTER_PROFILES, adapterAvailabilityDiagnostic, getAdapterAvailability, getNodeAdapterProfile, ModelError, type CalcEdge, type CalcModel, type CalcNode, type SignalValue, type SubsystemDefinition } from '../packages/model/src';

const node = (id: string, blockType: string, parameters: Record<string, unknown> = {}): CalcNode => ({ id, blockType, blockVersion: 1, label: id, parameters });
const edge = (source: string, target: string, port = 'in', output = 'out'): CalcEdge => ({ id: `${source}-${output}-${target}-${port}`, source: { nodeId: source, portId: output }, target: { nodeId: target, portId: port } });
const graph = (nodes: CalcNode[], edges: CalcEdge[], mode: CalcModel['execution']['mode'] = 'discrete'): CalcModel => ({ schemaVersion: 1, modelId: 'M14Compiler', name: 'M14Compiler', nodes, edges, layout: {}, execution: { mode, startTime: 0, stopTime: mode === 'static' ? 0 : 2, step: 1 } });
const message = (payload: SignalValue = 1): SignalValue => ({ kind: 'messages', items: [{ producer: 'Sender', sequence: 0, time: 0, priority: 0, payload }] });
function operation(type: string, parameters: Record<string, unknown> = {}, input: SignalValue = 2, mode: CalcModel['execution']['mode'] = 'discrete'): CalcModel {
  const nodes = [node('Input', 'source.signal', { value: input }), node('Adapter', type, parameters), node('Result', 'io.structured-output')];
  const edges = [edge('Input', 'Adapter'), edge('Adapter', 'Result')];
  if (type === 'adapter.wasm-accumulator') { nodes.push(node('Reset', 'source.constant', { value: false })); edges.push(edge('Reset', 'Adapter', 'reset')); }
  if (type === 'adapter.entity-transport') { const delay = node('Delay', 'source.constant', { value: 1 }); delay.unit = 's'; nodes.push(delay); edges.push(edge('Delay', 'Adapter', 'delay')); }
  return graph(nodes, edges, mode);
}
function codes(model: CalcModel): string[] { try { compileModel(model); return []; } catch (error) { if (!(error instanceof ModelError)) throw error; return error.diagnostics.map(item => item.code); } }
function nested(type: string, wrapper = 'hierarchy.atomic'): CalcModel {
  const body = operation(type, {}, type === 'adapter.entity-transport' ? message() : 2), output = body.nodes.find(node => node.id === 'Result')!;
  const definition: SubsystemDefinition = { id: 'Child', version: 1, name: 'Child', nodes: body.nodes, edges: body.edges, layout: {}, inputs: [], outputs: [{ id: 'out', nodeId: output.id }] };
  const model = graph([node('Scope', wrapper, { definitionId: 'Child' }), node('Result', 'io.structured-output')], [edge('Scope', 'Result')]); model.subsystems = [definition]; return model;
}

describe('M14 trusted adapter compiler and immutable availability catalog', () => {
  it('preserves all334 preceding definition objects and adds exactly3 substantive contracts', () => {
    const baseline = JSON.parse(readFileSync(new URL('../docs/baselines/m13-registry.json', import.meta.url), 'utf8')) as { id: string }[];
    const historical = new Map<string, (typeof blockRegistry)[number]>(registryWithoutApprovedObserverInputs(blockRegistry).map(definition => [definition.id, definition]));
    expect(baseline).toHaveLength(334); for (const definition of baseline) expect(historical.get(definition.id)).toEqual(definition);
    expect(M14_BLOCK_IDS).toHaveLength(3); expect(new Set(M14_BLOCK_IDS).size).toBe(3); expect(blockRegistry.length).toBeGreaterThanOrEqual(337);
  });
  it.each(['static', 'discrete', 'continuous'] as const)('compiles fixed finite scalar affine in %s without writing pins into the portable model', mode => {
    const model = operation('adapter.wasm-affine', { gain: 3, bias: -1 }, 2, mode), before = JSON.stringify(model), compiled = compileModel(model), adapter = compiled.nodes.find(node => node.id === 'Adapter')!;
    expect(JSON.stringify(model)).toBe(before); expect(adapter.outputs.out).toEqual({ valueType: 'float64', shape: [], unit: '1' });
    expect(adapter.parameters.adapterIdentity).toEqual({ id: 'calcweave.wasm-affine-f64-v1', version: 1, sha256: 'fc7801ff3c8d616c38773a0e26af62181f8281c8f06430193d0ed20fb239cb95', abiVersion: 1 });
    expect(compiled.model.nodes.find(node => node.id === 'Adapter')!.parameters).toEqual({ gain: 3, bias: -1 });
  });
  it.each([true, [1, 2], { kind: 'typed', dtype: 'float64', shape: [], data: [1] }] as SignalValue[])('requires explicit legacy f64 scalar ABI for %j', value => expect(codes(operation('adapter.wasm-affine', {}, value))).toContain('M14_ABI_SCALAR_REQUIRED'));
  it('requires dimensionless affine input instead of implicitly changing units', () => { const model = operation('adapter.wasm-affine'); model.nodes[0]!.unit = 'm'; expect(codes(model)).toContain('M14_ABI_SCALAR_REQUIRED'); });
  it.each(['moduleBytes', 'url', 'callback', 'adapterIdentity'])('rejects caller-selected code or pins parameter %s', name => expect(codes(operation('adapter.wasm-affine', { [name]: 'untrusted' }))).toContain('INVALID_PARAMETERS'));
  it('keeps accumulator data input non-feedthrough but reset requires current boolean', () => {
    const model = operation('adapter.wasm-accumulator', { initial: 1, gain: 2 }); expect(getDirectFeedthroughPorts(model.nodes[1]!)).toEqual(['reset']);
    model.nodes[0] = node('Input', 'math.gain', { gain: 1 }); model.edges.push(edge('Adapter', 'Input'));
    expect(codes(model)).toEqual([]); const compiled = compileModel(model); expect(compiled.nodes.find(node => node.id === 'Adapter')!.parameters.m14StateElements).toBe(16);
    model.nodes.find(node => node.id === 'Reset')!.parameters.value = 1; expect(codes(model)).toContain('M14_RESET_BOOLEAN_REQUIRED');
  });
  it.each(['hierarchy.atomic', 'hierarchy.subsystem'])('rejects stateful adapter hidden in %s origins but permits nested pure affine', wrapper => {
    expect(codes(nested('adapter.wasm-accumulator', wrapper))).toContain('M14_STATEFUL_ROOT_ONLY'); expect(codes(nested('adapter.entity-transport', wrapper))).toContain('M14_STATEFUL_ROOT_ONLY'); expect(codes(nested('adapter.wasm-affine', wrapper))).toEqual([]);
  });
  it('rejects static/continuous stateful modes with explicit unsupported diagnostics', () => { for (const mode of ['static', 'continuous'] as const) for (const type of ['adapter.wasm-accumulator', 'adapter.entity-transport']) expect(codes(operation(type, {}, type.endsWith('transport') ? message() : 2, mode))).toContain('UNSUPPORTED_MODE'); });
  it('infers true message payload/batch metadata, seconds delay and worst persistent storage', () => {
    const model = operation('adapter.entity-transport', { capacity: 4, maxRelease: 2 }, message({ kind: 'typed', dtype: 'string', shape: [], data: ['one'] })), compiled = compileModel(model), adapter = compiled.nodes.find(node => node.id === 'Adapter')!;
    expect(adapter.outputs.out.message!.maxBatch).toBe(2); expect(adapter.outputs.out.message!.payload.typed?.dtype).toBe('string'); expect(adapter.outputs.count).toEqual({ valueType: 'float64', shape: [], unit: '1' });
    expect(Number(adapter.parameters.m14StateElements)).toBeGreaterThan(4 * 256 + 128 * 65); expect(compiled.stateElements).toBeGreaterThan(Number(adapter.parameters.m14StateElements));
    expect(getDirectFeedthroughPorts(model.nodes[1]!)).toEqual(['in', 'delay']);
    model.nodes.find(node => node.id === 'Delay')!.unit = '1'; expect(codes(model)).toContain('M14_ABI_SCALAR_REQUIRED');
  });
  it('bounds queue storage from descriptor maximum rather than short initial string values', () => {
    const payload: SignalValue = { kind: 'typed', dtype: 'string', shape: [16], data: Array(16).fill('') };
    expect(codes(operation('adapter.entity-transport', { capacity: 64, maxRelease: 1 }, message(payload)))).toContain('STATE_BUDGET_EXCEEDED');
    expect(codes(operation('adapter.entity-transport', {}, 1))).toContain('M14_MESSAGE_REQUIRED');
  });
  it('has exact fixed module pins, no elevated capabilities and explicit NOASSERTION rights', () => {
    expect(BUILTIN_ADAPTER_PROFILES).toHaveLength(3); expect(UNAVAILABLE_ADAPTER_PROFILES).toHaveLength(8); expect(ADAPTER_PROFILES).toHaveLength(11);
    for (const profile of ADAPTER_PROFILES) { expect(Object.isFrozen(profile)).toBe(true); expect(Object.values(profile.capabilities).every(value => value === false)).toBe(true); expect(profile.rights.license).toBe('NOASSERTION'); expect(profile.rights.externalCodeRedistribution).toBe('NOASSERTION'); expect(profile.nativeRuntimeEquivalenceClaimed).toBe(false); }
    expect(getNodeAdapterProfile('adapter.wasm-affine')!.artifact?.byteLength).toBe(48); expect(getNodeAdapterProfile('adapter.wasm-accumulator')!.artifact?.byteLength).toBe(121);
    expect(() => { (BUILTIN_ADAPTER_PROFILES[0]!.artifact!.exports as unknown as string[]).push('untrusted'); }).toThrow();
  });
  it('reports unavailable native environments without counting or executing metadata as blocks', () => {
    for (const profile of UNAVAILABLE_ADAPTER_PROFILES) { expect(getAdapterAvailability(profile.id).available).toBe(false); expect(adapterAvailabilityDiagnostic(profile.id, 'External')).toMatchObject({ code: 'M14_NATIVE_ENVIRONMENT_UNAVAILABLE', nodeId: 'External' }); expect(getBlockDefinition(profile.id)).toBeUndefined(); expect(profile.supportedModes).toEqual([]); expect(codes(graph([node('External', profile.id)], []))).toContain('M14_NATIVE_ENVIRONMENT_UNAVAILABLE'); }
    expect(adapterAvailabilityDiagnostic('unregistered')).toMatchObject({ code: 'M14_UNKNOWN_ADAPTER_PROFILE' }); expect(adapterAvailabilityDiagnostic('calcweave.wasm-affine-f64-v1')).toBeUndefined();
  });
});
