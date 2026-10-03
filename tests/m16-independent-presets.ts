import type { CalcModel, CalcNode, CalcEdge } from '../packages/model/src';
export interface M16PresetFixture { id: string; sourceId: string; canonical: 'math.sum' | 'source.constant'; parameters: Record<string, unknown>; expected: number; model: CalcModel }
const node = (id: string, blockType: CalcNode['blockType'], parameters: Record<string, unknown>): CalcNode => ({ id, blockType, blockVersion: 1, label: id, parameters });
const edge = (source: string, target: string, port: string): CalcEdge => ({ id: `${source}-${target}-${port}`, source: { nodeId: source, portId: 'out' }, target: { nodeId: target, portId: port } });
function fixture(id: string, sourceId: string, canonical: M16PresetFixture['canonical'], parameters: Record<string, unknown>, expected: number): M16PresetFixture {
  const nodes = [node('Operation', canonical, parameters), node('Result', 'sink.display', {})], edges = [edge('Operation', 'Result', 'in')];
  if (canonical === 'math.sum') { nodes.push(node('A', 'source.constant', { value: 7 }), node('B', 'source.constant', { value: 2 })); edges.push(edge('A', 'Operation', 'a'), edge('B', 'Operation', 'b')); }
  return { id, sourceId, canonical, parameters, expected, model: { schemaVersion: 1, modelId: id, name: id, nodes, edges, layout: {}, execution: { mode: 'static', startTime: 0, stopTime: 0, step: 1 } } };
}
/** Literal original fixed preset selectors and analytic expected values; no runtime function derives the oracle. */
export const M16_PRESET_FIXTURES: readonly M16PresetFixture[] = [
  fixture('m16-m1-add', '08-002', 'math.sum', { signs: '++' }, 9),
  fixture('m16-m1-subtract', '08-032', 'math.sum', { signs: '+-' }, 5),
  fixture('m16-m1-pi', '21-006', 'source.constant', { value: 3.141592653589793 }, 3.141592653589793),
  fixture('m16-m1-zero', '21-007', 'source.constant', { value: 0 }, 0),
];
