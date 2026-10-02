import { parseModel, type CalcModel } from '../../../packages/model/src';

export type ModelSelection = { nodes: string[]; edges: string[] };
export type ModelClipboard = Pick<CalcModel, 'nodes' | 'edges' | 'layout'>;

export function copySelection(model: CalcModel, selection: ModelSelection): ModelClipboard | null {
  const ids = new Set(selection.nodes);
  if (!ids.size) return null;
  return structuredClone({ nodes: model.nodes.filter(node => ids.has(node.id)), edges: model.edges.filter(edge => ids.has(edge.source.nodeId) && ids.has(edge.target.nodeId)), layout: Object.fromEntries(model.nodes.filter(node => ids.has(node.id)).map(node => [node.id, model.layout[node.id] ?? { x: 100, y: 100 }])) });
}

export function deleteSelection(model: CalcModel, selection: ModelSelection): CalcModel {
  const nodeIds = new Set(selection.nodes), edgeIds = new Set(selection.edges);
  return { ...model, nodes: model.nodes.filter(node => !nodeIds.has(node.id)), edges: model.edges.filter(edge => !edgeIds.has(edge.id) && !nodeIds.has(edge.source.nodeId) && !nodeIds.has(edge.target.nodeId)), layout: Object.fromEntries(Object.entries(model.layout).filter(([id]) => !nodeIds.has(id))) };
}

export function pasteSelection(model: CalcModel, clipboard: ModelClipboard, offset: number): { model: CalcModel; selectedIds: string[] } {
  if (model.nodes.length + clipboard.nodes.length > 1000 || model.edges.length + clipboard.edges.length > 5000) throw new Error('모델은 최대 1,000개 블록과 5,000개 연결을 담을 수 있습니다.');
  const ids = new Map(clipboard.nodes.map(node => [node.id, `block-${crypto.randomUUID()}`]));
  const nodes = clipboard.nodes.map(node => ({ ...structuredClone(node), id: ids.get(node.id)! }));
  const edges = clipboard.edges.map(edge => ({ ...edge, id: `edge-${crypto.randomUUID()}`, source: { ...edge.source, nodeId: ids.get(edge.source.nodeId)! }, target: { ...edge.target, nodeId: ids.get(edge.target.nodeId)! } }));
  const layout = Object.fromEntries(clipboard.nodes.map(node => {
    const position = clipboard.layout[node.id] ?? { x: 100, y: 100 };
    return [ids.get(node.id)!, { x: Math.max(-1e6, Math.min(1e6, position.x + offset)), y: Math.max(-1e6, Math.min(1e6, position.y + offset)) }];
  }));
  // Revalidate the complete model before one reversible history command.
  return { model: parseModel({ ...model, nodes: [...model.nodes, ...nodes], edges: [...model.edges, ...edges], layout: { ...model.layout, ...layout } }), selectedIds: nodes.map(node => node.id) };
}
