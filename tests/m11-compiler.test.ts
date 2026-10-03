import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blockRegistry, getBlockDefinition, getBlockPorts, getDirectFeedthroughPorts } from '../packages/block-library/src';
import { getDefinitionReferences, getM11ControlPorts, M11_BLOCK_IDS, M11_SCOPE_BLOCK_IDS } from '../packages/block-library/src/m11';
import { compileModel } from '../packages/compiler/src';
import { ModelError, type CalcEdge, type CalcModel, type CalcNode, type SignalDescriptor, type SignalValue, type SubsystemDefinition } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';
import { M11_INDEPENDENT_DEFINITION_FIXTURES } from './m11-independent-fixtures';

const node = (id: string, blockType: string, parameters: Record<string, unknown> = {}): CalcNode => ({ id, blockType, blockVersion: 1, label: id, parameters });
const edge = (source: string, target: string, port = 'in', output = 'out'): CalcEdge => ({ id: `${source}-${output}-${target}-${port}`, source: { nodeId: source, portId: output }, target: { nodeId: target, portId: port } });
const graph = (nodes: CalcNode[], edges: CalcEdge[], subsystems?: SubsystemDefinition[]): CalcModel => ({ schemaVersion: 1, modelId: 'M11Compiler', name: 'M11Compiler', nodes, edges, layout: {}, ...(subsystems ? { subsystems } : {}), execution: { mode: 'discrete', startTime: 0, stopTime: 2, step: 1 } });
function definition(id = 'Child'): SubsystemDefinition { return { id, version: 1, name: id, nodes: [node('Input', 'io.structured-input'), node('Compute', 'math.gain', { gain: 2 }), node('Output', 'io.structured-output')], edges: [edge('Input', 'Compute'), edge('Compute', 'Output')], layout: {}, inputs: [{ id: 'in', nodeId: 'Input' }], outputs: [{ id: 'out', nodeId: 'Output' }] }; }
function scoped(type = 'hierarchy.atomic', parameters: Record<string, unknown> = {}, controls: Record<string, SignalValue> = {}): CalcModel { const nodes = [node('Source', 'source.signal', { value: 3 }), node('Scope', type, { definitionId: 'Child', ...parameters }), node('Result', 'sink.scope')], edges = [edge('Source', 'Scope'), edge('Scope', 'Result')]; for (const [port, value] of Object.entries(controls)) { nodes.push(node(`Control_${port}`, 'source.signal', { value })); edges.push(edge(`Control_${port}`, 'Scope', port)); } return graph(nodes, edges, [definition()]); }
function fixture(id: string): CalcModel { return structuredClone(M11_INDEPENDENT_DEFINITION_FIXTURES.find(entry => entry.name === `m11-independent-${id.replaceAll('.', '-')}`)!.model); }
function diagnostics(model: CalcModel) { try { compileModel(model); return []; } catch (error) { if (!(error instanceof ModelError)) throw error; return error.diagnostics; } }
const codes = (model: CalcModel): string[] => diagnostics(model).map(diagnostic => diagnostic.code);
function operation(type: string, parameters: Record<string, unknown>, values: Record<string, SignalValue>): CalcModel { const nodes = [node('Operation', type, parameters), node('Result', 'sink.scope')], edges = [edge('Operation', 'Result')]; for (const [port, value] of Object.entries(values)) { nodes.push(node(`Source_${port}`, 'source.signal', { value })); edges.push(edge(`Source_${port}`, 'Operation', port)); } return graph(nodes, edges); }
const messages = (payload: SignalValue = 1, count = 1): SignalValue => ({ kind: 'messages', items: Array.from({ length: count }, (_, sequence) => ({ producer: 'Producer', sequence, time: 0, priority: 0, payload })) });

describe('M11 controlled hierarchy and structured compiler contracts', () => {
  it('preserves all245 preceding definitions exactly and registers48 independent operations', () => {
    const baseline = JSON.parse(readFileSync(new URL('../docs/baselines/m10-registry.json', import.meta.url), 'utf8')) as { id: string }[];
    expect(baseline).toHaveLength(245); for (const definition of baseline) expect(getBlockDefinition(definition.id)).toEqual(definition);
    expect(M11_BLOCK_IDS).toHaveLength(48); expect(M11_SCOPE_BLOCK_IDS).toHaveLength(19); expect(blockRegistry).toHaveLength(293);
    expect(new Set(blockRegistry.map(definition => definition.id)).size).toBe(293);
    expect(new Set(M11_INDEPENDENT_DEFINITION_FIXTURES.map(entry => entry.name))).toEqual(new Set(M11_BLOCK_IDS.map(id => `m11-independent-${id.replaceAll('.', '-')}`)));
  });
  it.each(M11_INDEPENDENT_DEFINITION_FIXTURES)('compiles $name in every declared mode with immutable JSON and insertion-order parity', entry => {
    for (const mode of entry.declaredModes) {
      const model = structuredClone(entry.model); model.execution.mode = mode;
      if (mode === 'continuous') model.execution.solver = { method: 'rk4', initialStep: 1, minStep: 1, maxStep: 1, discreteStep: 1 };
      const before = JSON.stringify(model), compiled = compileModel(model), roundtrip = compileModel(JSON.parse(JSON.stringify(compiled.model)));
      expect(JSON.stringify(model)).toBe(before); expect(roundtrip.semanticKey).toBe(compiled.semanticKey);
      expect(Object.isFrozen(compiled)).toBe(true); expect(Object.isFrozen(compiled.nodes)).toBe(true);
      const reversed = structuredClone(compiled.model); reversed.nodes.reverse(); reversed.edges.reverse(); reversed.subsystems?.reverse();
      expect(compileModel(reversed).semanticKey).toBe(compiled.semanticKey);
      expect(compileModel(reversed).nodes).toEqual(compiled.nodes);
    }
  });
  it('keeps executable child plans in IR while retaining portable references and real producer endpoints', () => {
    const model = scoped(), compiled = compileModel(model), scope = compiled.nodes.find(node => node.id === 'Scope')!;
    const program = scope.parameters.scopeProgram as { nodes: { id: string; blockType: string }[]; inputBindings: unknown; outputBindings: unknown };
    expect(program.inputBindings).toEqual([{ port: 'in', nodeId: 'Input' }]); expect(program.outputBindings).toEqual([{ port: 'out', source: { nodeId: 'Compute', portId: 'out' } }]);
    expect(program.nodes.find(node => node.id === 'Input')!.blockType).toBe('source.signal'); expect(program).not.toHaveProperty('model'); expect(program).not.toHaveProperty('subsystems');
    expect(compiled.model.nodes.find(node => node.id === 'Scope')!.parameters).not.toHaveProperty('scopeProgram');
    expect(compiled.model.subsystems![0]!.nodes.find(node => node.id === 'Input')!.blockType).toBe('io.structured-input');
    expect(getDirectFeedthroughPorts(scope)).toEqual(['in']); expect(compiled.outputIds).toEqual(['Result']);
  });
  it('uses selected variant references, validates inactive interfaces, and stores only the selected executable plan', () => {
    const model = scoped('hierarchy.variant', { alternateDefinitionId: 'Other', active: 'second' }); model.subsystems!.push(definition('Other'));
    const scope = compileModel(model).nodes.find(node => node.id === 'Scope')!;
    expect(getDefinitionReferences(scope)).toEqual([{ definitionId: 'Child', version: 1 }, { definitionId: 'Other', version: 1 }]);
    expect((scope.parameters.scopeProgram as { definitionId: string }).definitionId).toBe('Other');
    expect(scope.parameters.inactiveDefinition).toMatchObject({ definitionId: 'Child', version: 1 }); expect(scope.parameters.inactiveDefinition).not.toHaveProperty('nodes');
    const mismatch = structuredClone(model); mismatch.subsystems![0]!.outputs[0]!.id = 'different'; expect(codes(mismatch)).toContain('M11_VARIANT_INTERFACE');
    const outputMismatch = structuredClone(model); outputMismatch.subsystems![0]!.nodes.find(node => node.id === 'Compute')!.blockType = 'hierarchy.if'; outputMismatch.subsystems![0]!.nodes.find(node => node.id === 'Compute')!.parameters = {}; outputMismatch.subsystems![0]!.edges.find(edge => edge.target.nodeId === 'Output')!.source.portId = 'then'; expect(codes(outputMismatch)).toContain('M11_VARIANT_INTERFACE');
  });
  it('exposes genuine control/data ports while hiding loop index and while continuation boundaries', () => {
    expect(getM11ControlPorts({ blockType: 'hierarchy.enabled-triggered' })).toEqual(['enable', 'trigger']);
    const loop = fixture('hierarchy.for-iterator'); expect(getBlockPorts(loop.nodes.find(node => node.id === 'Operation')!, loop)).toEqual({ inputs: [], outputs: ['out'] });
    const whileModel = fixture('hierarchy.while-iterator'); expect(getBlockPorts(whileModel.nodes.find(node => node.id === 'Operation')!, whileModel)).toEqual({ inputs: ['in', 'condition'], outputs: ['out'] });
    expect(compileModel(whileModel).nodes.find(node => node.id === 'Operation')!.outputs).not.toHaveProperty('continue');
  });
  it.each(['enable', 'trigger', 'reset', 'action', 'condition'])('rejects vector and typed controls at %s', port => {
    const type = { enable: 'hierarchy.enabled', trigger: 'hierarchy.triggered', reset: 'hierarchy.resettable', action: 'hierarchy.action', condition: 'hierarchy.while-iterator' }[port]!;
    const model = scoped(type, {}, { [port]: [true, false] }); expect(codes(model)).toContain('M11_CONTROL_TYPE');
    model.nodes.find(node => node.id === `Control_${port}`)!.parameters.value = { kind: 'typed', dtype: 'boolean', shape: [], data: [true] }; expect(codes(model)).toContain('M11_CONTROL_TYPE');
  });
  it('requires boolean reset/action/while controls and permits finite scalar positive-level enable', () => {
    expect(codes(scoped('hierarchy.resettable', {}, { reset: 1 }))).toContain('M11_CONTROL_TYPE');
    expect(codes(scoped('hierarchy.action', {}, { action: 1 }))).toContain('M11_CONTROL_TYPE');
    expect(compileModel(scoped('hierarchy.enabled', {}, { enable: 2 })).outputTypes.Result!.shape).toEqual([]);
  });
  it('rejects unknown, stale, recursive, too-deep and reserved-control definition references', () => {
    expect(codes(scoped('hierarchy.atomic', { definitionId: 'Missing' }))).toContain('UNKNOWN_SUBSYSTEM_DEFINITION'); expect(codes(scoped('hierarchy.atomic', { version: 2 }))).toContain('STALE_SUBSYSTEM_VERSION');
    const recursive = scoped(); recursive.subsystems![0]!.nodes.push(node('Recursive', 'hierarchy.atomic', { definitionId: 'Child' })); expect(codes(recursive)).toContain('RECURSIVE_SUBSYSTEM');
    const collision = scoped('hierarchy.enabled', {}, { enable: true }); collision.subsystems![0]!.inputs[0]!.id = 'enable'; expect(codes(collision)).toContain('M11_CONTROL_PORT_COLLISION');
    const deep = scoped('hierarchy.atomic', { definitionId: 'D0' }); deep.subsystems = Array.from({ length: 9 }, (_, index) => { const child = definition(`D${index}`); if (index < 8) { child.nodes.find(node => node.id === 'Compute')!.blockType = 'hierarchy.atomic'; child.nodes.find(node => node.id === 'Compute')!.parameters = { definitionId: `D${index + 1}` }; } return child; }); expect(codes(deep)).toContain('HIERARCHY_DEPTH_EXCEEDED');
  });
  it('bounds loop nesting, partitions, total IR expansion, and selected child sample-time ABI', () => {
    const nested = scoped('hierarchy.for-iterator', { definitionId: 'D0' }); nested.subsystems = Array.from({ length: 5 }, (_, index) => { const child = definition(`D${index}`); if (index < 4) { child.nodes.find(node => node.id === 'Compute')!.blockType = 'hierarchy.for-iterator'; child.nodes.find(node => node.id === 'Compute')!.parameters = { definitionId: `D${index + 1}` }; } return child; }); expect(codes(nested)).toContain('M11_ITERATION_DEPTH');
    const partition = scoped('hierarchy.for-each'); partition.nodes.find(node => node.id === 'Source')!.parameters.value = Array(65).fill(1); expect(codes(partition)).toContain('M11_PARTITION_LIMIT');
    const expansion = scoped(); for (let index = 0; index < 250; index++) expansion.nodes.push(node(`Scope${index}`, 'hierarchy.atomic', { definitionId: 'Child' })), expansion.edges.push(edge('Source', `Scope${index}`)); expect(codes(expansion)).toContain('M11_PROGRAM_EXPANSION_BUDGET');
    const childRate = scoped(); childRate.subsystems![0]!.nodes.find(node => node.id === 'Compute')!.sampleTime = { period: 2, offset: 0 }; const childFailure = diagnostics(childRate); expect(childFailure[0]!.code).toBe('M11_CHILD_SAMPLE_TIME'); expect(childFailure[0]).toMatchObject({ nodeId: 'Scope', childNodeId: 'Compute', hierarchyPath: ['Scope'] });
  });
  it('rejects opaque parent feedback and supports child-local nonfeedthrough feedback', () => {
    const model = scoped(); model.edges.find(edge => edge.target.nodeId === 'Scope')!.source.nodeId = 'Scope'; expect(codes(model)).toContain('CYCLIC_DEPENDENCY');
    expect(compileModel(fixture('hierarchy.atomic')).nodes.find(node => node.id === 'Operation')!.parameters).toHaveProperty('scopeProgram');
  });
  it('preserves heterogeneous nested leaf units through child boundaries and initial output values', async () => {
    const model = graph([node('Distance', 'source.constant', { value: 3 }), node('Flag', 'source.constant', { value: true }), node('Bus', 'route.structured-bus'), node('Scope', 'hierarchy.atomic', { definitionId: 'Identity' }), node('Result', 'sink.scope')], [edge('Distance', 'Bus', 'in1'), edge('Flag', 'Bus', 'in2'), edge('Bus', 'Scope'), edge('Scope', 'Result')], [{ id: 'Identity', version: 1, name: 'Identity', nodes: [node('Input', 'io.structured-input'), node('Output', 'io.structured-output')], edges: [edge('Input', 'Output')], layout: {}, inputs: [{ id: 'in', nodeId: 'Input' }], outputs: [{ id: 'out', nodeId: 'Output' }] }]);
    model.nodes[0]!.unit = 'm'; const compiled = compileModel(model); expect(compiled.outputTypes.Result!.bus!.fields.map(field => field.descriptor.unit)).toEqual(['m', '1']);
    expect((await runModel(compiled)).samples[0]!.values.Result).toEqual({ kind: 'bus', fields: [{ name: 'a', value: 3 }, { name: 'b', value: true }] });
  });
  it('requires precise initial-output keys, values and batch capacity without rewriting the portable JSON', () => {
    expect(codes(scoped('hierarchy.atomic', { initialOutputs: '{"missing":0}' }))).toContain('INVALID_PARAMETERS'); expect(codes(scoped('hierarchy.atomic', { initialOutputs: '{"out":true}' }))).toContain('M11_INITIAL_OUTPUT_TYPE');
    const model = scoped(); model.subsystems![0]!.nodes.find(node => node.id === 'Compute')!.blockType = 'events.send'; model.subsystems![0]!.nodes.find(node => node.id === 'Compute')!.parameters = {}; model.subsystems![0]!.nodes.push(node('Send', 'source.constant', { value: true })); model.subsystems![0]!.edges.find(edge => edge.target.nodeId === 'Compute')!.target.portId = 'payload'; model.subsystems![0]!.edges.push(edge('Send', 'Compute', 'send'));
    model.nodes.find(node => node.id === 'Scope')!.parameters.initialOutputs = JSON.stringify({ out: messages(3) }); expect(compileModel(model).outputTypes.Result!.message!.maxBatch).toBe(1);
    model.nodes.find(node => node.id === 'Scope')!.parameters.initialOutputs = JSON.stringify({ out: messages(3, 2) }); expect(codes(model)).toContain('M11_INITIAL_OUTPUT_TYPE');
  });
  it('preserves message payload exact types and rejects nested messages, incompatible merges and legacy implicit consumption', () => {
    const typed: SignalValue = { kind: 'typed', dtype: 'uint64', shape: [], data: ['9007199254740993'] }; const bus: SignalValue = { kind: 'bus', fields: [{ name: 'exact', value: typed }, { name: 'flag', value: true }] };
    expect(codes(operation('math.gain', {}, { in: bus }))).toContain('M11_STRUCTURED_BOUNDARY_REQUIRED'); expect(codes(operation('events.send', {}, { payload: messages(1), send: true }))).toContain('M11_MESSAGE_NESTED');
    expect(codes(operation('events.message-merge', {}, { in1: messages(1), in2: messages(true) }))).toContain('M11_MESSAGE_PAYLOAD_TYPE');
    const result = compileModel(operation('events.receive', { initial: typed }, { in: messages(typed) })); expect(result.outputTypes.Result!.typed).toEqual({ dtype: 'uint64' });
  });
  it('preserves an explicitly typed empty message latch and validates metadata against actual input', async () => {
    const schema: SignalDescriptor = { valueType: 'messages', shape: [], unit: '1', message: { payload: { valueType: 'typed', shape: [], unit: '1', typed: { dtype: 'uint64' } }, maxBatch: 1 } };
    const typed: SignalValue = { kind: 'typed', dtype: 'uint64', shape: [], data: ['9007199254740993'] };
    const model = operation('events.feedback-latch', { initial: { kind: 'messages', items: [] }, initialDescriptor: JSON.stringify(schema) }, { in: messages(typed) });
    expect(compileModel(model).outputTypes.Result).toEqual(schema); expect((await runModel(compileModel(model))).samples[0]!.values.Result).toEqual({ kind: 'messages', items: [] });
    schema.message!.payload.typed!.dtype = 'int64'; model.nodes.find(node => node.id === 'Operation')!.parameters.initialDescriptor = JSON.stringify(schema); expect(codes(model)).toContain('M11_LATCH_TYPE');
  });
  it('retains physical bus leaf units in a declared feedback latch schema', () => {
    const schema: SignalDescriptor = { valueType: 'bus', shape: [], unit: '1', bus: { fields: [{ name: 'a', descriptor: { valueType: 'float64', shape: [], unit: 'm' } }, { name: 'b', descriptor: { valueType: 'boolean', shape: [], unit: '1' } }] } };
    const model = graph([node('Distance', 'source.constant', { value: 3 }), node('Flag', 'source.constant', { value: true }), node('Bus', 'route.structured-bus'), node('Latch', 'events.feedback-latch', { initial: { kind: 'bus', fields: [{ name: 'a', value: 0 }, { name: 'b', value: false }] }, initialDescriptor: JSON.stringify(schema) }), node('Result', 'sink.scope')], [edge('Distance', 'Bus', 'in1'), edge('Flag', 'Bus', 'in2'), edge('Bus', 'Latch'), edge('Latch', 'Result')]); model.nodes[0]!.unit = 'm';
    expect(compileModel(model).outputTypes.Result).toEqual(schema);
  });
  it('accounts for128 producer trackers, maximum queue payloads, and one persistent overlay per target', () => {
    const queue = compileModel(fixture('events.queue')).nodes.find(node => node.id === 'Operation')!; expect(queue.parameters.m11StateElements).toBe(16 * 82 + 128 * 65 + 3);
    const receive = compileModel(fixture('events.receive')).nodes.find(node => node.id === 'Operation')!; expect(receive.parameters.m11StateElements).toBe(1 + 128 * 65 + 1);
    const writerModel = fixture('state.parameter-writer'); writerModel.nodes.push(node('SecondWriter', 'state.parameter-writer', { target: 'Target', order: 1 })); writerModel.edges.push(edge('Source', 'SecondWriter')); const writers = compileModel(writerModel).nodes.filter(node => node.blockType === 'state.parameter-writer'); expect(writers.reduce((total, node) => total + Number(node.parameters.m11StateElements), 0)).toBe(81);
    const large: CalcNode[] = [], links: CalcEdge[] = []; for (let index = 0; index < 50; index++) { large.push(node(`Target${index}`, 'source.constant', { value: Array(1024).fill(1) }), node(`Writer${index}`, 'state.parameter-writer', { target: `Target${index}` })); links.push(edge('Input', `Writer${index}`)); } large.push(node('Input', 'source.constant', { value: Array(1024).fill(2) }), node('Result', 'sink.scope')); links.push(edge('Target0', 'Result')); expect(codes(graph(large, links))).toContain('STATE_BUDGET_EXCEEDED');
  });
  it.each(['route.data-store-read', 'route.data-store-write', 'state.reader', 'state.writer', 'state.parameter-writer'])('explicitly rejects static effect execution at %s', id => { const model = fixture(id); model.execution.mode = 'static'; expect(codes(model)).toContain('UNSUPPORTED_MODE'); });
  it('requires unique lexical Goto ownership and visibility instead of runtime global search', () => {
    const model = fixture('route.from'); model.nodes = model.nodes.filter(node => node.id !== 'Visibility'); expect(codes(model)).toContain('M11_VISIBILITY_REQUIRED');
    const duplicate = fixture('route.goto'); duplicate.nodes.push(node('Duplicate', 'route.goto', { name: 'Tag', scope: 'scoped' })); duplicate.edges.push(edge('Source', 'Duplicate')); expect(codes(duplicate)).toContain('M11_DUPLICATE_GOTO');
    const compiled = compileModel(fixture('route.from')); expect(compiled.nodes.find(node => node.id === 'From')!.inputs.in).toEqual({ nodeId: 'Source', portId: 'out' });
  });
  it('rejects inaccessible and duplicate stores and honors explicit effect order independent of insertion order', () => {
    const missing = fixture('route.data-store-read'); missing.nodes = missing.nodes.filter(node => node.id !== 'Memory'); expect(codes(missing)).toContain('M11_STORE_NOT_FOUND');
    const duplicate = fixture('route.data-store-memory'); duplicate.nodes.push(node('Duplicate', 'route.data-store-memory', { name: 'Data' })); expect(codes(duplicate)).toContain('M11_DUPLICATE_STORE');
    const conflict = fixture('route.data-store-write'); conflict.nodes.find(node => node.id === 'Read')!.parameters.order = 0; expect(codes(conflict)).toContain('M11_EFFECT_ORDER_CONFLICT');
    const ordered = fixture('route.data-store-read'), compiled = compileModel(ordered); expect(compiled.nodes.findIndex(node => node.id === 'Write')).toBeLessThan(compiled.nodes.findIndex(node => node.id === 'Read')); ordered.nodes.reverse(); ordered.edges.reverse(); expect(compileModel(ordered).nodes).toEqual(compiled.nodes);
    const cycle = fixture('route.data-store-write'); cycle.edges.find(edge => edge.target.nodeId === 'Write')!.source.nodeId = 'Read'; expect(codes(cycle)).toContain('M11_EFFECT_DEPENDENCY_CYCLE');
  });
  it('limits state/parameter writers to approved local slots, descriptors and immutable IR overlays', async () => {
    const badState = fixture('state.writer'); badState.nodes.find(node => node.id === 'Write')!.parameters.target = 'Source'; expect(codes(badState)).toContain('M11_STATE_TARGET_UNSUPPORTED');
    const badType = fixture('state.writer'); badType.nodes.find(node => node.id === 'Written')!.parameters.value = true; expect(codes(badType)).toContain('M11_STATE_WRITE_TYPE');
    const badParameter = fixture('state.parameter-writer'); badParameter.nodes.find(node => node.id === 'Operation')!.parameters.parameter = 'gain'; expect(codes(badParameter)).toContain('M11_PARAMETER_TARGET_UNSUPPORTED');
    const compiled = compileModel(fixture('state.parameter-writer')); await runModel(compiled); expect(compiled.nodes.find(node => node.id === 'Target')!.parameters.value).toBe(1); expect(compiled.model.nodes.find(node => node.id === 'Target')!.parameters.value).toBe(1);
  });
  it('resolves actual conditional publication origins and rejects ordinary value sources at Merge', () => {
    const compiled = compileModel(fixture('route.merge')); expect(compiled.nodes.find(node => node.id === 'Merge')!.parameters.mergeSources).toEqual({ in1: 'A', in2: 'B' });
    expect(codes(operation('route.merge', {}, { in1: 1, in2: 2 }))).toContain('M11_MERGE_SOURCE_REQUIRED');
  });
  it('gates held rate call counts by the producing event due and orders split output consumers explicitly', async () => {
    const model = scoped('hierarchy.function-call'); model.nodes.push(node('Generator', 'events.function-call-generator', { count: 2 })); model.nodes.at(-1)!.sampleTime = { period: 2, offset: 0 }; model.edges.push(edge('Generator', 'Scope', 'call'));
    const compiled = compileModel(model); expect(compiled.nodes.find(node => node.id === 'Scope')!.parameters.callEventRate).toEqual({ period: 2, offset: 0 }); expect((await runModel(compiled)).samples.map(sample => sample.values.Result)).toEqual([6, 6, 6]);
    const split = scoped('hierarchy.function-call'); split.nodes.push(node('Generator', 'events.function-call-generator'), node('Split', 'events.function-call-split'), node('ASecond', 'hierarchy.function-call', { definitionId: 'Child' })); split.edges.push(edge('Generator', 'Split'), edge('Split', 'Scope', 'call', 'out1'), edge('Split', 'ASecond', 'call', 'out2'), edge('Source', 'ASecond')); const order = compileModel(split).nodes.map(node => node.id); expect(order.indexOf('Scope')).toBeLessThan(order.indexOf('ASecond'));
  });
  it('uses the last actual due for terminate functions and refuses nested undefined lifecycle boundaries', async () => {
    const model = scoped('functions.terminate'); model.execution.stopTime = 3; model.nodes.find(node => node.id === 'Scope')!.sampleTime = { period: 2, offset: 0 }; model.nodes.find(node => node.id === 'Result')!.sampleTime = { period: 2, offset: 0 }; const compiled = compileModel(model); expect(compiled.nodes.find(node => node.id === 'Scope')!.parameters.terminalTick).toBe(2); expect((await runModel(compiled)).samples.map(sample => sample.values.Result)).toEqual([0, 0, 6, 6]);
    const nested = scoped(); nested.subsystems![0]!.nodes.find(node => node.id === 'Compute')!.blockType = 'functions.terminate'; nested.subsystems![0]!.nodes.find(node => node.id === 'Compute')!.parameters = { definitionId: 'Other' }; nested.subsystems!.push(definition('Other')); expect(codes(nested)).toContain('M11_NESTED_TERMINATE_UNSUPPORTED');
  });
  it('parses typed functions into a bounded safe AST and rejects executable JavaScript', () => {
    const model = operation('functions.typed', { expression: 'x*x+1' }, { in: 3 }); expect(compileModel(model).nodes.find(node => node.id === 'Operation')!.expression).toBeDefined();
    model.nodes.find(node => node.id === 'Operation')!.parameters.expression = 'globalThis.fetch("https://example.com")'; expect(diagnostics(model).length).toBeGreaterThan(0);
  });
});
