import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { createSubsystemFromSelection } from '../packages/compiler/src/hierarchy';
import { manifestForHash } from '../packages/codegen-ts/src/manifest';
import { canonicalSemantic, ENGINE_VERSION, sha256 } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';
import { createExample } from '../apps/web/src/examples';
import { appendHistory, historySnapshot, validateRunHistory, type HistoryRecord } from '../apps/web/src/run-history';
import { applyHierarchyView, hierarchyView, updateSubsystemInstances } from '../apps/web/src/hierarchy-editor';

async function record(id = 'run-1'): Promise<HistoryRecord> {
  const model = createExample('first-calculation'), compiled = compileModel(model), hash = sha256(compiled.semanticKey);
  return { id, label: model.name, createdAt: '2026-10-02T10:00:00Z', model, semanticHash: hash, engineVersion: ENGINE_VERSION, manifest: manifestForHash(compiled, hash), result: await runModel(compiled), outputIds: compiled.outputIds, outputTypes: compiled.outputTypes };
}
describe('M4 immutable bounded execution history', () => {
  it('detaches every model and raw result and evicts the oldest complete snapshot', async () => {
    const original = await record(), snapshot = historySnapshot(original);
    original.model.nodes[0]!.parameters.value = 99; original.result.samples[0]!.values.result = -1;
    expect(snapshot.model.nodes[0]!.parameters.value).toBe(2); expect(snapshot.result.samples[0]!.values.result).toBe(6);
    let history: HistoryRecord[] = [];
    for (let index = 0; index < 7; index += 1) history = appendHistory(history, { ...snapshot, id: `run-${index}` });
    expect(history.map(item => item.id)).toEqual(['run-6', 'run-5', 'run-4', 'run-3', 'run-2']);
    expect(validateRunHistory(history)).toEqual(history);
  });
  it('rejects corrupt hash, duplicate identity, nonfinite results, output types and cyclic raw input without mutating it', async () => {
    const valid = await record();
    const wrong = structuredClone(valid); wrong.model.nodes[0]!.parameters.value = 3;
    const before = JSON.stringify(wrong); expect(() => validateRunHistory([wrong])).toThrow(/hash/); expect(JSON.stringify(wrong)).toBe(before);
    expect(() => validateRunHistory([valid, valid])).toThrow(/ID/);
    const numeric = structuredClone(valid); numeric.result.samples[0]!.values.result = Infinity;
    expect(() => validateRunHistory([numeric])).toThrow();
    const type = structuredClone(valid); type.outputTypes.result!.shape = [-1];
    expect(() => validateRunHistory([type])).toThrow(/자료형/);
    const cyclic: unknown[] = []; cyclic.push(cyclic); expect(() => validateRunHistory(cyclic)).toThrow(/순환/);
  });
  it('refuses to truncate a record beyond 200,000 recorded scalar elements', async () => {
    const large = await record(); large.result.samples = Array.from({ length: 4000 }, (_, index) => ({ time: index, values: { result: Array.from({ length: 64 }, () => 1) } })); large.result.steps = 4000;
    expect(() => historySnapshot(large)).toThrow(/200,000/);
    expect(large.result.samples).toHaveLength(4000);
  });
});
describe('M4 hierarchy editor view and version transactions', () => {
  it('changes layout and labels without advancing semantic versions and propagates actual edits only through the entered instance', () => {
    const root = createSubsystemFromSelection(createExample('first-calculation'), ['gain'], 'Scale');
    const instance = root.nodes.find(node => node.blockType === 'hierarchy.subsystem')!;
    root.nodes.push({ ...structuredClone(instance), id: 'other-instance' });
    const viewed = hierarchyView(root, [instance.id]);
    const labelEdit = applyHierarchyView(root, [instance.id], { ...viewed.model, name: 'Renamed', layout: { ...viewed.model.layout, gain: { x: 300, y: 400 } } });
    expect(labelEdit.subsystems![0]!.version).toBe(1);
    expect(hierarchyView(labelEdit, [instance.id]).model.name).toBe('Renamed');
    const nextView = hierarchyView(labelEdit, [instance.id]).model;
    const edited = applyHierarchyView(labelEdit, [instance.id], { ...nextView, nodes: nextView.nodes.map(node => node.id === 'gain' ? { ...node, parameters: { gain: 4 } } : node) });
    expect(edited.subsystems![0]!.version).toBe(2);
    expect(edited.nodes.find(node => node.id === instance.id)!.parameters.version).toBe(2);
    expect(edited.nodes.find(node => node.id === 'other-instance')!.parameters.version).toBe(1);
    const refreshed = updateSubsystemInstances(edited);
    expect(refreshed.nodes.find(node => node.id === 'other-instance')!.parameters.version).toBe(2);
    expect(root.subsystems![0]!.nodes.find(node => node.id === 'gain')!.parameters.gain).toBe(3);
  });
  it('preserves newly extracted nested definitions and global execution settings', () => {
    const root = createSubsystemFromSelection(createExample('first-calculation'), ['gain'], 'Outer');
    const instance = root.nodes.find(node => node.blockType === 'hierarchy.subsystem')!;
    const nested = createSubsystemFromSelection(hierarchyView(root, [instance.id]).model, ['gain'], 'Inner');
    nested.execution = { ...nested.execution, mode: 'discrete', stopTime: 1 };
    const edited = applyHierarchyView(root, [instance.id], nested);
    expect(edited.subsystems).toHaveLength(2); expect(edited.execution.mode).toBe('discrete');
    expect(compileModel(edited).hierarchy!.instances).toHaveLength(2);
    expect(canonicalSemantic(edited)).not.toBe(canonicalSemantic(root));
  });
});
