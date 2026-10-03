import { describe, expect, it } from 'vitest';
import { EXAMPLES, createExample } from '../apps/web/src/examples';
import { applyHierarchyView, diagnosticLocation, hierarchyView, renameDefinitionPort, updateSubsystemInstances, validateBoundaryPortId } from '../apps/web/src/hierarchy-editor';
import { changeHierarchyMode, HIERARCHY_MODES } from '../apps/web/src/hierarchy-modes';
import { getBlockPorts } from '../packages/block-library/src';
import { getDefinitionReference, isDefinitionReference } from '../packages/block-library/src/m11';
import { createSubsystemFromSelection } from '../packages/compiler/src/hierarchy';
import { compileModel } from '../packages/compiler/src';
import { ModelError } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';

describe('M11 definition-backed editor', () => {
  it('preserves original examples while adding the controlled learning category', () => {
    expect(new Set(EXAMPLES.map(example => example.id)).size).toBe(EXAMPLES.length);
    expect(EXAMPLES.filter(example => example.category === 'hierarchy')).toHaveLength(8);
    expect(EXAMPLES.find(example => example.id === 'typed-integer64')?.category).toBe('typed');
    expect(EXAMPLES.find(example => example.id === 'first-calculation')?.category).toBe('basics');
  });
  it('opens controlled instances with the existing breadcrumb and commits shared definition versions', () => {
    const model = createExample('controlled-independent-states'), view = hierarchyView(model, ['first']);
    expect(view.definition?.id).toBe('accumulator'); expect(view.trail[0]?.label).toBe('첫 누적');
    const edited = applyHierarchyView(model, ['first'], { ...view.model, nodes: view.model.nodes.map(node => node.id === 'memory' ? { ...node, parameters: { ...node.parameters, initial: 5 } } : node) });
    expect(edited.subsystems![0]!.version).toBe(2);
    expect(edited.nodes.find(node => node.id === 'first')!.parameters.version).toBe(2);
    expect(edited.nodes.find(node => node.id === 'second')!.parameters.version).toBe(1);
    expect(updateSubsystemInstances(edited).nodes.find(node => node.id === 'second')!.parameters.version).toBe(2);
  });
  it('edits the active variant definition and refreshes both variant references explicitly', () => {
    const model = createExample('controlled-variant'); model.nodes.find(node => node.id === 'variant')!.parameters.active = 'second';
    const view = hierarchyView(model, ['variant']); expect(view.definition?.id).toBe('fivefold');
    const edited = applyHierarchyView(model, ['variant'], { ...view.model, nodes: view.model.nodes.map(node => node.id === 'gain' ? { ...node, parameters: { gain: 7 } } : node) });
    const instance = edited.nodes.find(node => node.id === 'variant')!;
    expect(instance.parameters.version).toBe(1); expect(instance.parameters.alternateVersion).toBe(2);
    edited.subsystems!.find(definition => definition.id === 'double')!.version = 3;
    const refreshed = updateSubsystemInstances(edited).nodes.find(node => node.id === 'variant')!;
    expect(refreshed.parameters.version).toBe(3); expect(refreshed.parameters.alternateVersion).toBe(2);
  });
  it('switches modes using registered defaults and retains selected definition references', () => {
    const model = createExample('controlled-variant'), instance = model.nodes.find(node => node.id === 'variant')!;
    instance.parameters.active = 'second';
    const enabled = changeHierarchyMode(instance, 'hierarchy.enabled');
    expect(getDefinitionReference(enabled)).toEqual({ definitionId: 'fivefold', version: 1 });
    expect(enabled.parameters.stateOnEnable).toBe('hold'); expect(enabled.parameters.active).toBeUndefined();
    const variant = changeHierarchyMode(enabled, 'hierarchy.variant');
    expect(variant.parameters.alternateDefinitionId).toBe('fivefold'); expect(variant.parameters.active).toBe('first');
    expect(() => changeHierarchyMode(instance, 'unregistered.type')).toThrow();
    expect(HIERARCHY_MODES.some(([id]) => id === 'hierarchy.while-iterator')).toBe(true);
  });
  it('shows control ports while hiding automatic iteration and continue boundaries', () => {
    const enabled = createExample('controlled-enable-state'), hold = enabled.nodes.find(node => node.id === 'hold')!;
    expect(isDefinitionReference(hold)).toBe(true); expect(getBlockPorts(hold, enabled)).toEqual({ inputs: ['in', 'enable'], outputs: ['out'] });
    const loop = createExample('controlled-for-iteration'); expect(getBlockPorts(loop.nodes[0]!, loop)).toEqual({ inputs: [], outputs: ['out'] });
    const condition = createExample('controlled-while-iteration'); expect(getBlockPorts(condition.nodes.find(node => node.id === 'loop')!, condition)).toEqual({ inputs: ['condition'], outputs: ['out'] });
  });
  it('renames generated aliases and preserves every active reference edge and version', () => {
    const root = createSubsystemFromSelection(createExample('first-calculation'), ['gain']), instance = root.nodes.find(node => node.blockType === 'hierarchy.subsystem')!, definition = root.subsystems![0]!;
    root.nodes.push({ ...structuredClone(instance), id: 'other' }); root.edges.push({ id: 'other-input', source: { nodeId: 'value', portId: 'out' }, target: { nodeId: 'other', portId: 'in1' } });
    const renamed = renameDefinitionPort(root, definition.id, definition.inputs[0]!.nodeId, 'in');
    expect(renamed.subsystems![0]!.inputs[0]!.id).toBe('in'); expect(renamed.subsystems![0]!.version).toBe(2);
    expect(renamed.edges.filter(edge => edge.target.nodeId === instance.id || edge.target.nodeId === 'other').map(edge => edge.target.portId)).toEqual(['in', 'in']);
    expect(renamed.nodes.filter(node => node.blockType === 'hierarchy.subsystem').map(node => node.parameters.version)).toEqual([2, 2]);
    expect(root.subsystems![0]!.inputs[0]!.id).toBe('in1');
  });
  it('makes a newly grouped in1/out1 diagram genuinely usable as a ForEach definition', async () => {
    const source = createExample('first-calculation'); source.nodes.find(node => node.id === 'value')!.parameters.value = [2, 3]; source.execution = { mode: 'discrete', startTime: 0, stopTime: 1, step: 1 };
    let model = createSubsystemFromSelection(source, ['gain']); const definition = model.subsystems![0]!, instance = model.nodes.find(node => node.blockType === 'hierarchy.subsystem')!;
    model = renameDefinitionPort(model, definition.id, definition.inputs[0]!.nodeId, 'in'); model = renameDefinitionPort(model, definition.id, definition.outputs[0]!.nodeId, 'out');
    model.nodes = model.nodes.map(node => node.id === instance.id ? changeHierarchyMode(node, 'hierarchy.for-each') : node);
    expect((await runModel(compileModel(model))).samples.map(sample => sample.values.result)).toEqual([[6, 9], [6, 9]]);
  });
  it('rejects unsafe and duplicate boundary IDs while retaining the original definition', () => {
    for (const value of ['constructor', '__proto__', 'prototype', 'two words', '1x', 'a'.repeat(65)]) expect(() => validateBoundaryPortId(value)).toThrow();
    const root = createExample('controlled-for-iteration'), definition = root.subsystems![0]!;
    definition.inputs.push({ id: 'already', nodeId: 'other-input' });
    expect(() => renameDefinitionPort(root, definition.id, 'iteration', 'already')).toThrow(); expect(definition.inputs[0]!.id).toBe('iteration');
  });
  it('resolves an actual failing while child into its exact editable instance path', async () => {
    const model = createExample('controlled-while-iteration');
    const child = model.subsystems![0]!.nodes.find(node => node.id === 'bias')!;
    child.blockType = 'math.function'; child.parameters = { operation: 'reciprocal' };
    let failure: ModelError | undefined;
    try { await runModel(compileModel(model)); } catch (error) { if (error instanceof ModelError) failure = error; else throw error; }
    expect(failure).toBeInstanceOf(ModelError);
    const diagnostic = failure!.diagnostics.find(item => item.code === 'NUMERIC_DIVIDE_BY_ZERO')!;
    expect(diagnostic).toMatchObject({ nodeId: 'loop', hierarchyPath: ['loop'], childNodeId: 'bias', iteration: 0 });
    expect(diagnosticLocation(model, diagnostic)).toEqual({ path: ['loop'], nodeId: 'bias' });
    expect(hierarchyView(model, ['loop']).model.nodes.find(node => node.id === 'bias')).toBe(child);
  });
  it('resolves nested controlled paths and the active variant without mutating the diagnostic', () => {
    const model = createExample('controlled-variant');
    model.nodes.find(node => node.id === 'variant')!.parameters.active = 'second';
    const child = model.subsystems!.find(definition => definition.id === 'fivefold')!;
    const leaf = structuredClone(child); leaf.id = 'leaf'; leaf.name = 'Nested leaf';
    child.nodes = [{ id: 'inner', blockVersion: 1, blockType: 'hierarchy.atomic', label: 'Nested instance', parameters: { definitionId: 'leaf', version: 1 } }];
    model.subsystems!.push(leaf);
    const diagnostic = { code: 'TEST', message: 'nested', nodeId: 'variant', hierarchyPath: ['variant', 'inner'], childNodeId: 'gain' };
    const location = diagnosticLocation(model, diagnostic)!;
    expect(location).toEqual({ path: ['variant', 'inner'], nodeId: 'gain' });
    location.path.pop(); expect(diagnostic.hierarchyPath).toEqual(['variant', 'inner']);
    expect(diagnosticLocation(createExample('first-calculation'), { code: 'TEST', message: 'root', nodeId: 'gain' })).toEqual({ path: [], nodeId: 'gain' });
  });
  it('rejects stale, overdeep or absent child locations instead of selecting an unrelated root node', () => {
    const model = createExample('controlled-variant');
    model.nodes.push({ id: 'gain', blockVersion: 1, blockType: 'math.gain', label: 'Root collision', parameters: { gain: 9 } });
    for (const diagnostic of [
      { hierarchyPath: ['gone'], childNodeId: 'gain' },
      { hierarchyPath: ['variant'], childNodeId: 'gone' },
      { hierarchyPath: ['variant'] },
      { hierarchyPath: Array(9).fill('variant'), childNodeId: 'gain' },
      { hierarchyPath: [''], childNodeId: 'gain' },
      { nodeId: 'missing' },
    ]) expect(diagnosticLocation(model, { code: 'TEST', message: 'stale', nodeId: 'gain', ...diagnostic })).toBeUndefined();
  });

});
