import { describe, expect, it } from 'vitest';
import { createExample } from '../apps/web/src/examples';
import { editorBlockPorts, planEditorConnection } from '../apps/web/src/observer-connections';
import { canvasDropPosition, parseDraggedBlock } from '../apps/web/src/block-library-drag';
import { multiInputOutputIds } from '../apps/web/src/output-labels';
import { compileModel } from '../packages/compiler/src';

describe('Canvas observer wiring and bounded library drag payloads', () => {
  it('offers a spare editor port without making the one-input model incomplete', () => {
    const model = createExample('first-calculation'), sink = model.nodes.find(node => node.id === 'result')!;
    expect(editorBlockPorts(sink, model).inputs).toEqual(['in', 'in2']);
    expect(sink.parameters.inputCount ?? 1).toBe(1); expect(compileModel(model).outputTypes.result.valueType).toBe('float64');
    const empty = { ...model, edges: [] }; expect(editorBlockPorts(sink, empty).inputs).toEqual(['in']);
  });
  it.each(['in', 'in2', null])('keeps the occupied input and plans a second input from %s', targetHandle => {
    const model = createExample('first-calculation');
    const plan = planEditorConnection(model, { source: 'value', sourceHandle: 'out', target: 'result', targetHandle })!;
    expect(plan.targetPort).toBe('in2'); expect(plan.targetNode.parameters.inputCount).toBe(2);
    expect(model.edges.at(-1)!.target.portId).toBe('in'); expect(model.nodes.at(-1)!.parameters.inputCount ?? 1).toBe(1);
  });
  it('uses an existing free input before growing, rejects invalid handles and full targets', () => {
    const model = createExample('first-calculation');
    model.nodes.at(-1)!.parameters.inputCount = 3;
    const connection = { source: 'value', sourceHandle: 'out', target: 'result', targetHandle: 'in' };
    expect(planEditorConnection(model, connection)!.targetPort).toBe('in2');
    expect(planEditorConnection(model, { ...connection, targetHandle: 'in16' })).toBeUndefined();
    expect(planEditorConnection(model, { ...connection, sourceHandle: 'wrong' })).toBeUndefined();
    expect(planEditorConnection(model, { ...connection, target: 'gain' })).toBeUndefined();
    model.nodes.at(-1)!.parameters.inputCount = 16;
    model.edges.push(...Array.from({ length: 15 }, (_, i) => ({ id: `occupied-${i}`, source: { nodeId: 'value', portId: 'out' }, target: { nodeId: 'result', portId: `in${i + 2}` } })));
    expect(editorBlockPorts(model.nodes.at(-1)!, model).inputs).toHaveLength(16);
    expect(planEditorConnection(model, connection)).toBeUndefined();
  });
  it('requires a recorded observer declaration, never infers multi-input mode from arbitrary bus names', () => {
    const model = createExample('first-calculation'); expect(multiInputOutputIds(model).size).toBe(0);
    const next = structuredClone(model); next.nodes.at(-1)!.parameters.inputCount = 2;
    expect([...multiInputOutputIds(next)]).toEqual(['result']); expect(multiInputOutputIds(model).size).toBe(0);
  });
  it.each(['source.constant', 'sink.scope', 'math.gain'])('permits registered drag type %s', type => expect(parseDraggedBlock(type)).toBe(type));
  it.each(['', 'unknown.block', '<img src=x onerror=alert(1)>', '__proto__', '../source.constant', 'a'.repeat(101)])('rejects unrelated or unbounded drag payload %s', value => expect(parseDraggedBlock(value)).toBeUndefined());
  it('snaps coordinates while preserving negative pan positions and rejecting non-finite/out-of-model points', () => {
    expect(canvasDropPosition({ x: 27, y: -42 })).toEqual({ x: 32, y: -48 });
    for (const x of [NaN, Infinity, -Infinity, 1_000_001]) expect(canvasDropPosition({ x, y: 0 })).toBeUndefined();
  });
});
