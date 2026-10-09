import { describe, expect, it } from 'vitest';
import { autoArrangeDiagram, type AutoLayoutOptions } from '../apps/web/src/auto-layout';
import { canonicalSemantic, type CalcEdge, type CalcModel, type CalcNode } from '../packages/model/src';
import { createExample } from '../apps/web/src/examples';
import { hierarchyView } from '../apps/web/src/hierarchy-editor';

function node(id: string, blockType = 'math.gain', parameters: Record<string, unknown> = { gain: 1 }): CalcNode {
  return { id, blockType, blockVersion: 1, label: id, parameters };
}
function edge(source: string, target: string, index = 0): CalcEdge {
  return { id: `edge-${source}-${target}-${index}`, source: { nodeId: source, portId: 'out' }, target: { nodeId: target, portId: 'in' } };
}
function graph(ids: string[], edges: CalcEdge[] = []): CalcModel {
  return { schemaVersion: 1, modelId: 'layout-model', name: 'Layout', nodes: ids.map(id => node(id)), edges,
    execution: { mode: 'static', startTime: 0, stopTime: 1, step: 1 }, layout: Object.fromEntries(ids.map((id, index) => [id, { x: index % 2 ? -480 : 480, y: index % 3 * -120 }])) };
}
function assertBoxes(model: CalcModel, options: AutoLayoutOptions = {}) {
  const layout = autoArrangeDiagram(model, options);
  for (const id of model.nodes.map(item => item.id)) {
    const point = layout[id]!;
    expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    expect(point.x % 16).toBe(0); expect(point.y % 16).toBe(0);
    expect(Math.abs(point.x)).toBeLessThanOrEqual(1_000_000); expect(Math.abs(point.y)).toBeLessThanOrEqual(1_000_000);
  }
  for (let left = 0; left < model.nodes.length; left++) {
    for (let right = left + 1; right < model.nodes.length; right++) {
      const a = model.nodes[left]!, b = model.nodes[right]!, pa = layout[a.id]!, pb = layout[b.id]!;
      const da = options.dimensions?.[a.id] ?? { width: 236, height: 124 }, db = options.dimensions?.[b.id] ?? { width: 236, height: 124 };
      const separate = pa.x + (da.width ?? 236) <= pb.x || pb.x + (db.width ?? 236) <= pa.x || pa.y + (da.height ?? 124) <= pb.y || pb.y + (db.height ?? 124) <= pa.y;
      expect(separate, `${a.id} and ${b.id} overlap`).toBe(true);
    }
  }
  return layout;
}

describe('bounded canvas auto arrangement', () => {
  it('returns a detached unchanged empty layout', () => {
    const model = graph([]); model.layout = { extra: { x: 10, y: 20 } };
    const layout = autoArrangeDiagram(model);
    expect(layout).toEqual(model.layout); expect(layout).not.toBe(model.layout);
  });

  it('places an acyclic chain left to right, independent of scrambled positions', () => {
    const model = graph(['first', 'middle', 'last'], [edge('first', 'middle'), edge('middle', 'last')]);
    const layout = assertBoxes(model);
    expect(layout.first!.x).toBeLessThan(layout.middle!.x); expect(layout.middle!.x).toBeLessThan(layout.last!.x);
    expect(layout.first!.y).toBe(layout.middle!.y); expect(layout.middle!.y).toBe(layout.last!.y);
  });

  it('aligns branch layers and centers the joining producer and sink', () => {
    const model = graph(['source', 'upper', 'lower', 'sink'], [edge('source', 'upper'), edge('source', 'lower'), edge('upper', 'sink'), edge('lower', 'sink')]);
    const layout = assertBoxes(model);
    expect(layout.upper!.x).toBe(layout.lower!.x); expect(layout.upper!.y).not.toBe(layout.lower!.y);
    expect(layout.source!.y).toBe(layout.sink!.y);
    expect(layout.source!.y).toBeGreaterThan(Math.min(layout.upper!.y, layout.lower!.y));
    expect(layout.source!.y).toBeLessThan(Math.max(layout.upper!.y, layout.lower!.y));
  });

  it('reduces a two-lane crossing by ordering endpoints by their actual producers', () => {
    const model = graph(['producerA', 'producerB', 'sinkA', 'sinkB', 'join'], [edge('producerA', 'sinkB'), edge('producerB', 'sinkA'), edge('sinkA', 'join'), edge('sinkB', 'join')]);
    const layout = assertBoxes(model);
    expect(Math.sign(layout.producerA!.y - layout.producerB!.y)).toBe(Math.sign(layout.sinkB!.y - layout.sinkA!.y));
  });

  it('keeps directed feedback cycles, self-loops and downstream nodes without overlap', () => {
    const model = graph(['a', 'b', 'c', 'before', 'after'], [edge('before', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', 'a'), edge('b', 'b'), edge('c', 'after')]);
    const saved = structuredClone(model);
    const layout = assertBoxes(model);
    expect(layout.before!.x).toBeLessThan(layout.a!.x); expect(layout.a!.x).toBeLessThan(layout.b!.x); expect(layout.b!.x).toBeLessThan(layout.c!.x); expect(layout.c!.x).toBeLessThan(layout.after!.x);
    expect(model).toEqual(saved);
  });

  it('places isolated annotations and separate components in distinct shelf rectangles', () => {
    const model = graph(['a', 'b', 'c', 'd', 'note'], [edge('a', 'b'), edge('c', 'd')]);
    model.nodes.at(-1)!.blockType = 'annotation.note'; model.nodes.at(-1)!.parameters = { text: 'Observation' };
    assertBoxes(model);
  });

  it('is idempotent and invariant to node and edge enumeration or old coordinates', () => {
    const model = graph(['a', 'b', 'c', 'd', 'e'], [edge('a', 'c'), edge('b', 'c'), edge('c', 'd'), edge('d', 'b')]);
    const first = autoArrangeDiagram(model);
    expect(autoArrangeDiagram({ ...model, layout: first })).toEqual(first);
    expect(autoArrangeDiagram({ ...model, nodes: [...model.nodes].reverse(), edges: [...model.edges].reverse(), layout: {} })).toEqual(first);
  });

  it('honors measured widths and tall dynamic-port node dimensions', () => {
    const model = graph(['a', 'b', 'join'], [edge('a', 'join'), edge('b', 'join')]);
    const options = { dimensions: { a: { width: 300, height: 640 }, b: { width: 512, height: 100 }, join: { width: 180, height: 192 } } };
    const layout = assertBoxes(model, options);
    expect(layout.join!.x - layout.a!.x).toBeGreaterThanOrEqual(512 + 96);
    expect(Math.abs(layout.a!.y - layout.b!.y)).toBeGreaterThanOrEqual(640 + 64);
  });

  it('accounts for unmeasured multi-port height and long boundary labels', () => {
    const model = graph(['a', 'b', 'join'], [edge('a', 'join'), edge('b', 'join')]);
    model.nodes[0] = node('a', 'route.demux', { count: 16 }); model.nodes[1]!.label = 'Boundary'.repeat(12);
    const layout = autoArrangeDiagram(model, { boundaryNodeIds: ['b'] });
    expect(layout.b!.y - layout.a!.y).toBeGreaterThanOrEqual(17 * 26 + 64);
  });

  it('falls back for nonfinite, negative or oversized measured dimensions', () => {
    const model = graph(['a', 'b', 'join'], [edge('a', 'join'), edge('b', 'join')]);
    const reference = autoArrangeDiagram(model);
    expect(autoArrangeDiagram(model, { dimensions: { a: { width: NaN, height: Infinity }, b: { width: -1, height: 1e20 }, join: { width: 1e20, height: -10 } } })).toEqual(reference);
  });

  it('deduplicates parallel graph arcs without touching model edge ports', () => {
    const model = graph(['a', 'b'], [edge('a', 'b')]);
    const more = { ...model, edges: [...model.edges, { ...edge('a', 'b', 1), target: { nodeId: 'b', portId: 'another' } }] };
    expect(autoArrangeDiagram(more)).toEqual(autoArrangeDiagram(model));
    expect(more.edges[1]!.target.portId).toBe('another');
  });

  it('arranges known nodes while preserving invalid outside-view endpoints and layout entries', () => {
    const model = graph(['a', 'b'], [edge('a', 'missing')]); model.layout.outside = { x: 88, y: -77 };
    const saved = structuredClone(model), layout = assertBoxes(model);
    expect(layout.outside).toEqual({ x: 88, y: -77 }); expect(model).toEqual(saved);
  });

  it('changes only positions, leaving canonical semantics and nested model data intact', () => {
    const model = createExample('first-calculation'); model.notes = 'Retain notes';
    const saved = structuredClone(model), semantic = canonicalSemantic(model);
    const layout = autoArrangeDiagram(model);
    expect(canonicalSemantic({ ...model, layout })).toBe(semantic); expect(model).toEqual(saved);
    expect({ ...model, layout: saved.layout }).toEqual(saved);
  });

  it('arranges a current hierarchy view without moving any root or sibling definition', () => {
    const model = createExample('hierarchy-edit');
    const reference = model.nodes.find(item => item.blockType === 'hierarchy.subsystem')!;
    const view = hierarchyView(model, [reference.id]);
    const saved = structuredClone(model), layout = assertBoxes(view.model);
    expect(Object.keys(layout).sort()).toEqual(view.model.nodes.map(item => item.id).sort());
    expect(model).toEqual(saved);
  });

  it('handles the full 1,000-node directed chain without recursion or coordinate overflow', () => {
    const ids = Array.from({ length: 1_000 }, (_, index) => `node-${String(index).padStart(4, '0')}`);
    const model = graph(ids, ids.slice(1).map((id, index) => edge(ids[index]!, id)));
    const layout = autoArrangeDiagram(model);
    expect(Object.keys(layout)).toHaveLength(1_000);
    expect(layout[ids.at(-1)!]!.x).toBeLessThanOrEqual(1_000_000);
    for (let index = 1; index < ids.length; index++) expect(layout[ids[index]!]!.x).toBeGreaterThan(layout[ids[index - 1]!]!.x);
  });

  it('packs a 1,000-node wide fan-out using bounded vertical bands and no box overlap', () => {
    const ids = Array.from({ length: 1_000 }, (_, index) => `node-${String(index).padStart(4, '0')}`);
    const model = graph(ids, ids.slice(1).map(id => edge(ids[0]!, id)));
    const dimensions = Object.fromEntries(ids.map(id => [id, { width: 236, height: 32_768 }]));
    const layout = autoArrangeDiagram(model, { dimensions });
    const boxesByX = new Map<number, { id: string; y: number }[]>();
    for (const id of ids) {
      const point = layout[id]!;
      expect(point.x).toBeLessThanOrEqual(1_000_000); expect(point.y).toBeLessThanOrEqual(1_000_000);
      const column = boxesByX.get(point.x) ?? []; column.push({ id, y: point.y }); boxesByX.set(point.x, column);
    }
    for (const column of boxesByX.values()) {
      column.sort((a, b) => a.y - b.y);
      for (let index = 1; index < column.length; index++) expect(column[index]!.y - column[index - 1]!.y).toBeGreaterThanOrEqual(32_768 + 64);
    }
    expect(boxesByX.size).toBeGreaterThan(2);
  });

  it('packs 1,000 tall disconnected nodes into multiple shelves within coordinate bounds', () => {
    const ids = Array.from({ length: 1_000 }, (_, index) => `node-${String(index).padStart(4, '0')}`);
    const model = graph(ids), dimensions = Object.fromEntries(ids.map(id => [id, { width: 512, height: 32_768 }]));
    const layout = autoArrangeDiagram(model, { dimensions });
    expect(new Set(Object.values(layout).map(point => point.y)).size).toBeGreaterThan(1);
    expect(Math.max(...Object.values(layout).map(point => point.x))).toBeLessThanOrEqual(1_000_000);
    expect(Math.max(...Object.values(layout).map(point => point.y))).toBeLessThanOrEqual(1_000_000);
  });

  it('handles a full-size strongly connected component iteratively and deterministically', () => {
    const ids = Array.from({ length: 1_000 }, (_, index) => `node-${String(index).padStart(4, '0')}`);
    const model = graph(ids, ids.map((id, index) => edge(id, ids[(index + 1) % ids.length]!)));
    const layout = autoArrangeDiagram(model);
    expect(Object.keys(layout)).toHaveLength(1_000);
    expect(autoArrangeDiagram({ ...model, nodes: [...model.nodes].reverse(), edges: [...model.edges].reverse() })).toEqual(layout);
    expect(new Set(Object.values(layout).map(point => point.x)).size).toBe(1_000);
    expect(Math.max(...Object.values(layout).map(point => point.x))).toBeLessThanOrEqual(1_000_000);
  });

  it('preserves non-overlap, direction and permutation invariance across seeded graphs', () => {
    for (let seed = 1; seed <= 6; seed++) {
      let state = seed;
      const random = () => { state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0; return state / 4_294_967_296; };
      const ids = Array.from({ length: 32 }, (_, index) => `n${String(index).padStart(2, '0')}`), arcs: CalcEdge[] = [];
      for (let left = 0; left < ids.length; left++) for (let right = left + 1; right < ids.length; right++) {
        if (random() < 0.1) arcs.push(edge(ids[left]!, ids[right]!));
      }
      const dag = graph(ids, arcs), layout = assertBoxes(dag);
      for (const arc of arcs) expect(layout[arc.source.nodeId]!.x).toBeLessThan(layout[arc.target.nodeId]!.x);
      expect(autoArrangeDiagram({ ...dag, nodes: [...dag.nodes].reverse(), edges: [...dag.edges].reverse() })).toEqual(layout);
      const feedback = { ...dag, edges: [...arcs, edge('n31', 'n00'), edge('n23', 'n08')] }, cyclic = assertBoxes(feedback);
      expect(autoArrangeDiagram({ ...feedback, layout: cyclic })).toEqual(cyclic);
    }
  });

  it('rejects duplicate or unsafe IDs and graphs above existing node/edge limits', () => {
    expect(() => autoArrangeDiagram(graph(['a', 'a']))).toThrow(/ID/);
    expect(() => autoArrangeDiagram(graph(['__proto__']))).toThrow(/ID/);
    expect(() => autoArrangeDiagram(graph(Array.from({ length: 1_001 }, (_, index) => `n${index}`)))).toThrow(/1,000/);
    expect(() => autoArrangeDiagram(graph(['a', 'b'], Array.from({ length: 5_001 }, (_, index) => edge('a', 'b', index))))).toThrow(/5,000/);
  });
});
