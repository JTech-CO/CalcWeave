import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { createSubsystemFromSelection, flattenHierarchy, hierarchyNodeId, subsystemDefinitionHash, subsystemSemanticKey } from '../packages/compiler/src/hierarchy';
import { canonicalSemantic, ModelError, parseModel, serializeModel, type CalcEdge, type CalcModel, type CalcNode, type SubsystemDefinition } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';

const node = (id: string, blockType: string, parameters: Record<string, unknown> = {}): CalcNode => ({ id, blockType, blockVersion: 1, label: id, parameters });
const edge = (source: string, target: string, targetPort = 'in', sourcePort = 'out', id = `${source}-${target}-${targetPort}-${sourcePort}`): CalcEdge => ({ id, source: { nodeId: source, portId: sourcePort }, target: { nodeId: target, portId: targetPort } });
const instance = (id: string, definitionId = 'gainDef', version = 1): CalcNode => node(id, 'hierarchy.subsystem', { definitionId, version });
const gainDef = (): SubsystemDefinition => ({ id: 'gainDef', version: 1, name: 'Gain definition', nodes: [node('input', 'io.input', { value: -999 }), node('gain', 'math.gain', { gain: 3 }), node('output', 'io.output')], edges: [edge('input', 'gain'), edge('gain', 'output')], layout: { gain: { x: 200, y: 80 } }, inputs: [{ id: 'in', nodeId: 'input' }], outputs: [{ id: 'out', nodeId: 'output' }] });
const graph = (definition = gainDef()): CalcModel => ({ schemaVersion: 1, modelId: 'hierarchy', name: 'Hierarchy', nodes: [node('source', 'source.constant', { value: 2 }), instance('box', definition.id), node('view', 'sink.display')], edges: [edge('source', 'box'), edge('box', 'view')], execution: { mode: 'static', startTime: 0, stopTime: 1, step: 0.1 }, layout: { source: { x: 0, y: 0 }, box: { x: 200, y: 0 }, view: { x: 400, y: 0 } }, subsystems: [definition] });
const failure = (model: CalcModel, code: string): void => {
  try { flattenHierarchy(model); throw new Error('Expected hierarchy failure'); }
  catch (error) { expect(error).toBeInstanceOf(ModelError); expect((error as ModelError).diagnostics.some((diagnostic) => diagnostic.code === code)).toBe(true); }
};

describe('M4 transparent subsystem expansion', () => {
  it('rewires marker aliases, retains root IDs and safely namespaces only primitive leaves', async () => {
    const model = graph(); const snapshot = JSON.stringify(model); const flat = flattenHierarchy(model);
    const gainId = hierarchyNodeId(['box'], 'gain');
    expect(flat.model.nodes.map((item) => item.id).sort()).toEqual([gainId, 'source', 'view'].sort());
    expect(flat.model.edges.find((item) => item.target.nodeId === gainId)?.source).toEqual({ nodeId: 'source', portId: 'out' });
    expect(flat.model.edges.find((item) => item.target.nodeId === 'view')).toEqual(edge(gainId, 'view', 'in', 'out', 'box-view-in-out'));
    expect(flat.origins[gainId]).toEqual({ path: ['box', 'gain'], rootNodeId: 'box', definitionId: 'gainDef' });
    expect(flat.instances).toEqual([{ nodeId: 'box', path: ['box'], definitionId: 'gainDef', version: 1, definitionHash: subsystemDefinitionHash(gainDef()) }]);
    expect(flat.model.subsystems).toBeUndefined();
    expect((await runModel(compileModel(model))).samples[0]!.values.view).toBe(6);
    expect(JSON.stringify(model)).toBe(snapshot);
    flat.model.nodes.find((item) => item.id === gainId)!.parameters.gain = 99;
    expect(model.subsystems![0]!.nodes[1]!.parameters.gain).toBe(3);
  });

  it('compiles exactly the same equations as a flat graph and retains the portable source snapshot', async () => {
    const model = graph(); const compiled = compileModel(model);
    const flat = flattenHierarchy(model).model; const direct = compileModel(flat);
    expect(compiled.nodes).toEqual(direct.nodes);
    expect(compiled.stateIds).toEqual(direct.stateIds);
    expect(compiled.model.subsystems).toHaveLength(1);
    expect(compiled.semanticKey).toBe(canonicalSemantic(model));
    expect(compiled.hierarchy?.instances[0]?.definitionId).toBe('gainDef');
    expect(Object.isFrozen(compiled.hierarchy?.origins)).toBe(true);
    expect((await runModel(compiled)).samples).toEqual((await runModel(direct)).samples);
  });

  it('keeps internal result sinks and their paths instead of dropping them during expansion', async () => {
    const definition = gainDef(); definition.nodes.push(node('trace', 'sink.scope')); definition.edges.push(edge('gain', 'trace'));
    const compiled = compileModel(graph(definition)); const trace = hierarchyNodeId(['box'], 'trace');
    expect(compiled.outputIds).toEqual([trace, 'view'].sort());
    expect(compiled.hierarchy?.origins[trace]?.path).toEqual(['box', 'trace']);
    expect((await runModel(compiled)).samples[0]!.values).toEqual({ [trace]: 6, view: 6 });
  });

  it('clones discrete state independently for repeated references and preserves per-leaf rates', async () => {
    const definition = gainDef(); definition.nodes[1] = { ...node('gain', 'discrete.unit-delay', { initial: 0 }), sampleTime: { period: 2, offset: 1 } };
    const model = graph(definition); model.execution = { mode: 'discrete', startTime: 0, stopTime: 0.4, step: 0.1 };
    model.nodes.push(node('otherSource', 'source.constant', { value: 5 }), instance('otherBox'), node('otherView', 'sink.display'));
    model.nodes.filter((item) => item.blockType === 'sink.display').forEach((item) => { item.sampleTime = { period: 2, offset: 1 }; });
    model.edges.push(edge('otherSource', 'otherBox'), edge('otherBox', 'otherView'));
    const compiled = compileModel(model); const first = hierarchyNodeId(['box'], 'gain'), second = hierarchyNodeId(['otherBox'], 'gain');
    expect(compiled.stateIds).toEqual([first, second].sort());
    expect(compiled.nodes.find((item) => item.id === first)?.sampleTime).toEqual({ period: 2, offset: 1 });
    const run = await runModel(compiled);
    expect(run.samples.map((sample) => sample.values.view)).toEqual([0, 0, 0, 2, 2]);
    expect(run.samples.map((sample) => sample.values.otherView)).toEqual([0, 0, 0, 5, 5]);
    expect(run.finalState).toEqual({ [first]: 2, [second]: 5 });
  });

  it('supports multiple nesting levels and bypasses a pure input-to-output definition', async () => {
    const inner = gainDef(); const outer: SubsystemDefinition = { ...gainDef(), id: 'outer', nodes: [node('input', 'io.input'), instance('nested'), node('output', 'io.output')], edges: [edge('input', 'nested'), edge('nested', 'output')], layout: {} };
    const model = graph(outer); model.subsystems!.push(inner);
    const compiled = compileModel(model); const id = hierarchyNodeId(['box', 'nested'], 'gain');
    expect(compiled.hierarchy?.origins[id]).toEqual({ path: ['box', 'nested', 'gain'], rootNodeId: 'box', definitionId: 'gainDef' });
    expect(compiled.hierarchy?.instances.map((item) => item.path)).toEqual([['box'], ['box', 'nested']]);
    expect((await runModel(compiled)).samples[0]!.values.view).toBe(6);
    const pass = gainDef(); pass.nodes.splice(1, 1); pass.edges = [edge('input', 'output')]; pass.layout = {};
    const transparent = compileModel(graph(pass)); expect(transparent.nodes).toHaveLength(2);
    expect((await runModel(transparent)).samples[0]!.values.view).toBe(2);
  });

  it('preserves continuous state, external reset edges and ordinary boolean signal typing', async () => {
    const definition = gainDef(); definition.nodes[1] = node('gain', 'continuous.integrator', { initial: 0, reset: 'rising' });
    definition.nodes.push(node('resetMarker', 'io.input', { value: false })); definition.inputs.push({ id: 'reset', nodeId: 'resetMarker' }); definition.edges.push(edge('resetMarker', 'gain', 'reset'));
    const model = graph(definition); model.execution = { mode: 'continuous', startTime: 0, stopTime: 0.2, step: 0.1 };
    model.nodes.push(node('reset', 'source.constant', { value: false })); model.edges.push(edge('reset', 'box', 'reset'));
    const compiled = compileModel(model); const id = hierarchyNodeId(['box'], 'gain');
    expect(compiled.nodes.find((item) => item.id === id)?.inputs.reset).toEqual({ nodeId: 'reset', portId: 'out' });
    const result = await runModel(compiled); result.samples.forEach((sample) => expect(sample.values.view).toBeCloseTo(sample.time * 2, 13));
    expect(result.events).toEqual([]);
  });

  it('lets ordinary compilation enforce signal shape, type and unit compatibility across ports', async () => {
    const model = graph(); model.nodes[0]!.parameters.value = [2, 4]; model.nodes[0]!.unit = 'm';
    const compiled = compileModel(model);
    expect(compiled.outputTypes.view).toEqual({ valueType: 'float64', shape: [2], unit: 'm' });
    expect((await runModel(compiled)).samples[0]!.values.view).toEqual([6, 12]);
    model.nodes[0]!.parameters.value = [true, false]; model.nodes[0]!.unit = '1';
    try { compileModel(model); throw new Error('Expected numeric input rejection'); }
    catch (error) { expect(error).toBeInstanceOf(ModelError); expect((error as ModelError).diagnostics.some((item) => item.code === 'TYPE_MISMATCH')).toBe(true); }
  });

  it('keeps rate mismatch checks active after removing transparent boundary markers', () => {
    const model = graph(); model.execution.mode = 'discrete'; model.subsystems![0]!.nodes[1]!.sampleTime = { period: 2, offset: 0 };
    try { compileModel(model); throw new Error('Expected rate mismatch rejection'); }
    catch (error) { expect(error).toBeInstanceOf(ModelError); expect((error as ModelError).diagnostics.some((item) => item.code === 'SAMPLE_TIME_MISMATCH')).toBe(true); }
  });

  it('round-trips hierarchy JSON and makes IDs, hashes and compilation independent of insertion order', () => {
    const model = graph(); const reordered = parseModel(JSON.parse(serializeModel(model))); reordered.nodes.reverse(); reordered.edges.reverse();
    const definition = reordered.subsystems![0]!; definition.nodes.reverse(); definition.edges.reverse(); definition.name = '설명만'; definition.layout = {}; definition.nodes.forEach((item) => { item.label = '블럭 이름'; });
    const first = flattenHierarchy(model), second = flattenHierarchy(reordered);
    expect(first.model.nodes).not.toEqual(second.model.nodes); // Labels remain editable presentation.
    expect(compileModel(model).nodes).toEqual(compileModel(reordered).nodes);
    expect(first.instances).toEqual(second.instances);
    expect(subsystemSemanticKey(model.subsystems![0]!)).toBe(subsystemSemanticKey(definition));
    expect(canonicalSemantic(model)).toBe(canonicalSemantic(reordered));
    definition.nodes.find((item) => item.id === 'gain')!.parameters.gain = 4;
    expect(subsystemDefinitionHash(model.subsystems![0]!)).not.toBe(subsystemDefinitionHash(definition));
  });

  it('excludes documentation-only annotations from reusable definition hashes', () => {
    const definition = gainDef(); const key = subsystemSemanticKey(definition), hash = subsystemDefinitionHash(definition);
    definition.nodes.push(node('note', 'annotation.note', { text: '설명만 변경합니다.' }));
    expect(subsystemSemanticKey(definition)).toBe(key); expect(subsystemDefinitionHash(definition)).toBe(hash);
    definition.nodes.find((item) => item.id === 'note')!.parameters.text = '다른 메모';
    expect(subsystemDefinitionHash(definition)).toBe(hash);
  });
});

describe('M4 hierarchy validation and finite expansion budgets', () => {
  it.each([
    ['UNKNOWN_SUBSYSTEM_DEFINITION', (model: CalcModel) => { model.nodes[1]!.parameters.definitionId = 'missing'; }],
    ['STALE_SUBSYSTEM_VERSION', (model: CalcModel) => { model.nodes[1]!.parameters.version = 2; }],
    ['INVALID_SUBSYSTEM_PARAMETERS', (model: CalcModel) => { model.nodes[1]!.parameters.bad = true; }],
    ['INVALID_SUBSYSTEM_PARAMETERS', (model: CalcModel) => { delete model.nodes[1]!.parameters.version; }],
    ['UNKNOWN_SUBSYSTEM_PORT', (model: CalcModel) => { model.edges[0]!.target.portId = 'notAnInput'; }],
    ['UNKNOWN_SUBSYSTEM_PORT', (model: CalcModel) => { model.edges[1]!.source.portId = 'notAnOutput'; }],
    ['MISSING_SUBSYSTEM_INPUT', (model: CalcModel) => { model.edges.splice(0, 1); }],
    ['DUPLICATE_INPUT', (model: CalcModel) => { model.edges.push({ ...structuredClone(model.edges[0]!), id: 'duplicate' }); }],
    ['DANGLING_SUBSYSTEM_OUTPUT', (model: CalcModel) => { model.subsystems![0]!.edges.pop(); }],
    ['INVALID_SUBSYSTEM_PORT', (model: CalcModel) => { model.subsystems![0]!.inputs[0]!.nodeId = 'gain'; }],
    ['INVALID_SUBSYSTEM_PORT_EDGE', (model: CalcModel) => { model.subsystems![0]!.edges[0]!.source.portId = 'other'; }],
    ['DANGLING_SUBSYSTEM_EDGE', (model: CalcModel) => { model.subsystems![0]!.edges[0]!.source.nodeId = 'missing'; }],
    ['HIERARCHY_BOUNDARY_ANNOTATION', (model: CalcModel) => { model.nodes[1]!.unit = 'm'; }],
    ['HIERARCHY_BOUNDARY_ANNOTATION', (model: CalcModel) => { model.nodes[1]!.sampleTime = { period: 2, offset: 0 }; }],
    ['HIERARCHY_BOUNDARY_ANNOTATION', (model: CalcModel) => { model.subsystems![0]!.nodes[0]!.unit = 'm'; }],
  ] as const)('rejects %s without mutating the supplied model', (code, mutate) => {
    const model = graph(); mutate(model); const snapshot = JSON.stringify(model); failure(model, code); expect(JSON.stringify(model)).toBe(snapshot);
  });

  it('rejects direct/indirect definition recursion and pure alias cycles', () => {
    const direct = graph(); direct.subsystems![0]!.nodes[1] = instance('gain'); failure(direct, 'RECURSIVE_SUBSYSTEM');
    const indirect = graph(); indirect.subsystems![0]!.nodes[1] = instance('gain', 'other');
    const other = { ...gainDef(), id: 'other' }; other.nodes[1] = instance('gain'); indirect.subsystems!.push(other); failure(indirect, 'RECURSIVE_SUBSYSTEM');
    const pass = gainDef(); pass.nodes.splice(1, 1); pass.edges = [edge('input', 'output')]; pass.layout = {};
    const cycle = graph(pass); cycle.nodes.splice(0, 1); cycle.edges[0]!.source = { nodeId: 'box', portId: 'out' }; delete cycle.layout.source;
    failure(cycle, 'HIERARCHY_ALIAS_CYCLE');
  });

  it('accepts eight levels and rejects nine before expansion', () => {
    const definitions: SubsystemDefinition[] = Array.from({ length: 9 }, (_, index) => ({ id: `def${index}`, version: 1, name: `Level ${index}`, nodes: index < 8 ? [instance('next', `def${index + 1}`)] : [node('leaf', 'source.constant')], edges: [], layout: {}, inputs: [], outputs: [] }));
    const model = graph(); model.nodes = [instance('box', 'def1')]; model.edges = []; model.layout = {}; model.subsystems = definitions.slice(1);
    expect(flattenHierarchy(model).instances).toHaveLength(8);
    model.nodes[0]!.parameters.definitionId = 'def0'; model.subsystems = definitions; failure(model, 'HIERARCHY_DEPTH_EXCEEDED');
  });

  it('rejects namespace collisions instead of overwriting a root block', () => {
    const model = graph(); model.nodes.push(node(hierarchyNodeId(['box'], 'gain'), 'source.constant'));
    failure(model, 'HIERARCHY_ID_COLLISION');
  });

  it('bounds expanded primitive nodes independently from definition library size', () => {
    const definition: SubsystemDefinition = { id: 'many', version: 1, name: 'Many', nodes: Array.from({ length: 600 }, (_, index) => node(`node${index}`, 'source.constant')), edges: [], layout: {}, inputs: [], outputs: [] };
    const model = graph(); model.nodes = [instance('first', 'many'), instance('second', 'many')]; model.edges = []; model.layout = {}; model.subsystems = [definition];
    failure(model, 'HIERARCHY_NODE_LIMIT');
  });

  it('bounds expanded edges and instance metadata even for marker-free empty definitions', () => {
    const manyEdges: SubsystemDefinition = { id: 'many', version: 1, name: 'Edges', nodes: [node('source', 'source.constant'), node('target', 'sink.display')], edges: Array.from({ length: 3_000 }, (_, index) => edge('source', 'target', 'in', 'out', `edge${index}`)), layout: {}, inputs: [], outputs: [] };
    const model = graph(); model.nodes = [instance('first', 'many'), instance('second', 'many')]; model.edges = []; model.layout = {}; model.subsystems = [manyEdges];
    failure(model, 'HIERARCHY_EDGE_LIMIT');
    model.nodes = [instance('first', 'def0')];
    model.subsystems = Array.from({ length: 5 }, (_, depth) => ({ id: `def${depth}`, version: 1, name: `Level ${depth}`, nodes: depth < 4 ? Array.from({ length: 10 }, (_, index) => instance(`child${index}`, `def${depth + 1}`)) : [], edges: [], layout: {}, inputs: [], outputs: [] }));
    failure(model, 'HIERARCHY_INSTANCE_LIMIT');
  });
});

describe('M4 grouping editor helper', () => {
  it('groups boundary fan-out, preserves exact numerical behavior and leaves the original untouched', async () => {
    const model: CalcModel = { schemaVersion: 1, modelId: 'group', name: 'Group', nodes: [node('source', 'source.constant', { value: 2 }), node('gain', 'math.gain', { gain: 3 }), node('sum', 'math.sum'), node('view', 'sink.display'), node('trace', 'sink.scope')], edges: [edge('source', 'gain'), edge('source', 'sum', 'b'), edge('gain', 'sum', 'a'), edge('sum', 'view'), edge('sum', 'trace')], execution: { mode: 'static', startTime: 0, stopTime: 1, step: 0.1 }, layout: { gain: { x: 300, y: 150 }, sum: { x: 550, y: 150 } } };
    const original = JSON.stringify(model); const grouped = createSubsystemFromSelection(model, ['sum', 'gain'], '보관 계산');
    expect(JSON.stringify(model)).toBe(original);
    expect(grouped.subsystems![0]!.inputs).toHaveLength(1);
    expect(grouped.subsystems![0]!.outputs).toHaveLength(1);
    expect(grouped.nodes.some((item) => item.blockType === 'hierarchy.subsystem')).toBe(true);
    expect((await runModel(compileModel(grouped))).samples).toEqual((await runModel(compileModel(model))).samples);
    expect((await runModel(compileModel(grouped))).samples[0]!.values).toEqual({ trace: 8, view: 8 });
  });

  it('can group an entire model with internal sinks and no external ports', async () => {
    const model = graph(); const flat = flattenHierarchy(model).model;
    const grouped = createSubsystemFromSelection(flat, flat.nodes.map((item) => item.id));
    const definition = grouped.subsystems![0]!; expect(definition.inputs).toEqual([]); expect(definition.outputs).toEqual([]);
    const run = await runModel(compileModel(grouped)); expect(Object.values(run.samples[0]!.values)).toEqual([6]);
  });

  it('rejects empty/missing selections and more than eight distinct boundary signals', () => {
    expect(() => createSubsystemFromSelection(graph(), [])).toThrow(ModelError);
    expect(() => createSubsystemFromSelection(graph(), ['missing'])).toThrow(ModelError);
    const model = graph(); model.nodes = [node('target', 'math.gain'), ...Array.from({ length: 9 }, (_, index) => node(`source${index}`, 'source.constant'))];
    model.edges = Array.from({ length: 9 }, (_, index) => edge(`source${index}`, 'target', `in${index}`)); model.layout = {}; delete model.subsystems;
    expect(() => createSubsystemFromSelection(model, ['target'])).toThrow(/8개/);
  });
});
