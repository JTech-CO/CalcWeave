import { getBlockPorts } from '../../../packages/block-library/src';
import { isSafeIdentifier, MODEL_LIMITS, type CalcModel } from '../../../packages/model/src';

type Position = { x: number; y: number };
type Size = { width: number; height: number };
export interface AutoLayoutOptions {
  /** React Flow measured dimensions, in unscaled canvas coordinates. */
  dimensions?: Record<string, { width?: number; height?: number }>;
  boundaryNodeIds?: readonly string[];
}

const GRID = 16;
const COLUMN_GAP = 96;
const ROW_GAP = 64;
const COMPONENT_GAP = 128;
const MAX_BAND_HEIGHT = 65_536;
const MAX_COORDINATE = 1_000_000; // model positionSchema bounds
const snapUp = (value: number) => Math.ceil(value / GRID) * GRID;
const compareId = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

/** Iterative Kosaraju: no recursion even for the maximum-length feedback chain. */
function stronglyConnected(outgoing: number[][], incoming: number[][]): number[][] {
  const seen = new Set<number>(), finished: number[] = [];
  for (let root = 0; root < outgoing.length; root++) {
    if (seen.has(root)) continue;
    seen.add(root);
    const stack = [{ node: root, next: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const next = outgoing[frame.node]![frame.next++];
      if (next === undefined) { finished.push(frame.node); stack.pop(); }
      else if (!seen.has(next)) { seen.add(next); stack.push({ node: next, next: 0 }); }
    }
  }
  seen.clear();
  const components: number[][] = [];
  for (let index = finished.length - 1; index >= 0; index--) {
    const root = finished[index]!;
    if (seen.has(root)) continue;
    const members: number[] = [], stack = [root];
    seen.add(root);
    while (stack.length) {
      const node = stack.pop()!;
      members.push(node);
      for (const previous of incoming[node]!) if (!seen.has(previous)) { seen.add(previous); stack.push(previous); }
    }
    components.push(members.sort((a, b) => a - b));
  }
  return components.sort((left, right) => left[0]! - right[0]!);
}

interface ArrangedComponent { positions: Map<number, Position>; width: number; height: number }

/**
 * Arrange this view only. Directed layers and four barycenter sweeps reduce
 * crossings; SCCs retain feedback rather than removing or reversing edges.
 * This is a bounded layout heuristic, not a global crossing-minimum solver.
 */
export function autoArrangeDiagram(model: CalcModel, options: AutoLayoutOptions = {}): Record<string, Position> {
  if (model.nodes.length > MODEL_LIMITS.maxNodes || model.edges.length > MODEL_LIMITS.maxEdges) {
    throw new RangeError('자동 정렬은 블록 1,000개와 연결 5,000개 이내에서 사용할 수 있습니다.');
  }
  const nodes = [...model.nodes].sort((left, right) => compareId(left.id, right.id));
  if (nodes.some((node, index) => !isSafeIdentifier(node.id) || node.id === nodes[index - 1]?.id)) {
    throw new RangeError('자동 정렬할 블록의 ID를 확인하세요.');
  }
  const result = { ...model.layout };
  if (!nodes.length) return result;
  const indices = new Map(nodes.map((node, index) => [node.id, index]));
  const outgoingSets = nodes.map(() => new Set<number>()), incomingSets = nodes.map(() => new Set<number>());
  for (const edge of model.edges) {
    const source = indices.get(edge.source.nodeId), target = indices.get(edge.target.nodeId);
    // An invalid imported endpoint is still diagnosed by the compiler. Layout
    // can arrange the known blocks without changing that edge or diagnostic.
    if (source === undefined || target === undefined) continue;
    outgoingSets[source]!.add(target); incomingSets[target]!.add(source);
  }
  const outgoing = outgoingSets.map(set => [...set].sort((a, b) => a - b));
  const incoming = incomingSets.map(set => [...set].sort((a, b) => a - b));
  const boundaryIds = new Set(options.boundaryNodeIds ?? []);
  const sizes: Size[] = nodes.map(node => {
    const ports = getBlockPorts(node, model), measured = options.dimensions?.[node.id];
    const portHeight = (Math.max(ports.inputs.length, ports.outputs.length) + 1) * 26;
    const labelHeight = boundaryIds.has(node.id) ? Math.ceil(node.label.length / 18) * 28 + 32 : 124;
    const fallbackHeight = Math.max(124, portHeight, labelHeight);
    if (fallbackHeight > 32_768) throw new RangeError('자동 정렬할 블록의 포트 수가 상한을 초과했습니다.');
    const dimension = (value: number | undefined, fallback: number, maximum: number) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= maximum ? snapUp(value) : snapUp(fallback);
    return { width: Math.max(176, dimension(measured?.width, 236, 512)), height: Math.max(snapUp(portHeight), 96, dimension(measured?.height, fallbackHeight, 32_768)) };
  });
  const strongly = stronglyConnected(outgoing, incoming);
  const groupOf = new Map<number, number>();
  strongly.forEach((members, group) => members.forEach(node => groupOf.set(node, group)));
  const groupOut = strongly.map(() => new Set<number>()), groupIn = strongly.map(() => new Set<number>());
  outgoing.forEach((targets, source) => targets.forEach(target => {
    const from = groupOf.get(source)!, to = groupOf.get(target)!;
    if (from !== to) { groupOut[from]!.add(to); groupIn[to]!.add(from); }
  }));
  const remaining = groupIn.map(set => set.size), groupRank = strongly.map(() => 0);
  const ready = strongly.flatMap((_, group) => remaining[group] === 0 ? [group] : []);
  for (let cursor = 0; cursor < ready.length; cursor++) {
    const group = ready[cursor]!;
    for (const target of [...groupOut[group]!].sort((a, b) => a - b)) {
      groupRank[target] = Math.max(groupRank[target]!, groupRank[group]! + strongly[group]!.length);
      if (--remaining[target]! === 0) ready.push(target);
    }
  }
  const rank = nodes.map(() => 0);
  strongly.forEach((members, group) => members.forEach((node, order) => { rank[node] = groupRank[group]! + order; }));

  // Weak components are packed independently so unconnected annotations and
  // separate systems cannot sit on top of one another.
  const weak: number[][] = [], seen = new Set<number>();
  for (let root = 0; root < nodes.length; root++) {
    if (seen.has(root)) continue;
    const members: number[] = [], stack = [root];
    seen.add(root);
    while (stack.length) {
      const node = stack.pop()!;
      members.push(node);
      for (const adjacent of [...outgoing[node]!, ...incoming[node]!]) {
        if (!seen.has(adjacent)) { seen.add(adjacent); stack.push(adjacent); }
      }
    }
    weak.push(members.sort((a, b) => a - b));
  }
  const arranged: ArrangedComponent[] = weak.map(members => {
    const layers = new Map<number, number[]>();
    for (const node of members) {
      const layer = layers.get(rank[node]!);
      if (layer) layer.push(node); else layers.set(rank[node]!, [node]);
    }
    const layerKeys = [...layers.keys()].sort((a, b) => a - b);
    const order = new Map<number, number>();
    const updateOrder = () => layers.forEach(layer => layer.forEach((node, index) => order.set(node, index)));
    updateOrder();
    for (let sweep = 0; sweep < 4; sweep++) {
      const forward = sweep % 2 === 0;
      for (const key of forward ? layerKeys : [...layerKeys].reverse()) {
        const layer = layers.get(key)!;
        const scores = new Map<number, number>();
        for (const node of layer) {
          const neighbors = (forward ? incoming[node]! : outgoing[node]!).filter(adjacent => forward ? rank[adjacent]! < key : rank[adjacent]! > key);
          scores.set(node, neighbors.length ? neighbors.reduce((sum, adjacent) => sum + order.get(adjacent)!, 0) / neighbors.length : order.get(node)!);
        }
        layer.sort((a, b) => scores.get(a)! - scores.get(b)! || a - b);
        layer.forEach((node, index) => order.set(node, index));
      }
    }
    const positions = new Map<number, Position>();
    let x = 0, height = 0;
    for (const key of layerKeys) {
      const bands: { nodes: number[]; height: number; width: number }[] = [];
      for (const node of layers.get(key)!) {
        const size = sizes[node]!, previous = bands.at(-1);
        if (!previous || previous.height + ROW_GAP + size.height > MAX_BAND_HEIGHT) {
          bands.push({ nodes: [node], height: size.height, width: size.width });
        } else {
          previous.nodes.push(node); previous.height += ROW_GAP + size.height;
          previous.width = Math.max(previous.width, size.width);
        }
      }
      for (const band of bands) {
        let y = 0;
        for (const node of band.nodes) { positions.set(node, { x, y }); y += sizes[node]!.height + ROW_GAP; }
        height = Math.max(height, band.height); x += band.width + COLUMN_GAP;
      }
    }
    // Center shorter columns against the actual component's height. Every
    // column remains independently non-overlapping and aligned to the grid.
    const columnHeights = new Map<number, number>();
    positions.forEach((position, node) => columnHeights.set(position.x, Math.max(columnHeights.get(position.x) ?? 0, position.y + sizes[node]!.height)));
    positions.forEach(position => { position.y += Math.floor((height - columnHeights.get(position.x)!) / (2 * GRID)) * GRID; });
    return { positions, width: x - COLUMN_GAP, height };
  });
  const area = arranged.reduce((sum, component) => sum + (component.width + COMPONENT_GAP) * (component.height + COMPONENT_GAP), 0);
  const shelfWidth = Math.max(1_024, ...arranged.map(component => component.width), snapUp(Math.sqrt(area) * 1.5));
  let shelfX = 64, shelfY = 64, shelfHeight = 0;
  for (const component of arranged) {
    if (shelfX > 64 && shelfX + component.width > shelfWidth + 64) {
      shelfX = 64; shelfY += shelfHeight + COMPONENT_GAP; shelfHeight = 0;
    }
    component.positions.forEach((position, node) => {
      const next = { x: shelfX + position.x, y: shelfY + position.y };
      if (next.x > MAX_COORDINATE || next.y > MAX_COORDINATE) throw new RangeError('자동 정렬 결과가 모델 좌표 상한을 초과했습니다.');
      result[nodes[node]!.id] = next;
    });
    shelfX += component.width + COMPONENT_GAP; shelfHeight = Math.max(shelfHeight, component.height);
  }
  return result;
}
